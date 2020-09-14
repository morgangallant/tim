import { User, Activity, NLIntent, NLRequest, NLResponse, NLLog } from "./models";
import { JSONToObj, WritePrefixedCounterValue, GetLastPrefixedCounterSet, GetLastPrefixedCounterValue } from './helpers';
import { v4 as uuidv4 } from 'uuid';

/**
 * A simple handler which returns 'Hello World' to any incoming request. This is
 * used mostly for testing purposes.
 * @param req The incoming HTTP request.
 */
export async function HelloWorldHandler(req: Request): Promise<Response> {
    return new Response('Hello World');
}

class TelegramWebhook {
    message: {
        text: string;
        chat: {
            id: number;
        };
        from: {
            id: number;
            is_bot: boolean;
            first_name: string;
            last_name: string;
            username: string;
        };
    };
}

/**
 * Sends a message to a user via Telegram.
 * @param chat The Telegram chat id to send the message to.
 * @param text The message content.
 */
export async function SendTelegramMessage(
    chat: number,
    text: string,
): Promise<void> {
    const url = `https://api.telegram.org/bot${TELEGRAM_KEY}/sendMessage`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            chat_id: chat,
            text: text,
        }),
    });
    if (response.status != 200) {
        throw new Error(`invalid telegram status returned: ${response.status}`);
    }
}

/**
 * CreateNewUser creates a new user structure with a unique identifier.
 */
function CreateNewUser(): User {
    const u = new User();
    u.uid = uuidv4();
    u.interfaces = {};
    return u;
}

/**
 * Does a lookup for a user from the contents of a Telegram webhook. If the user
 * is not found or requires updates, these will be written to datastore before
 * returning.
 * @param wh The incoming Telegram webhook.
 */
async function LookupTelegramUser(wh: TelegramWebhook): Promise<User> {
    // This is assuming that Telegram is the only interface since if the telegram
    // interface doesn't exist, a new user is created. This is incorrect, and
    // should be corrected when new interfaces are created.
    var user: User;
    var uchanges = false;
    const tlookup = `interfaces:telegram:${wh.message.from.id}`;
    const userid = await TIMDB.get(tlookup, 'text');
    if (userid == null) {
        user = CreateNewUser();
        await TIMDB.put(tlookup, user.uid);
        uchanges = true;
    } else {
        user = await JSONToObj(
            await TIMDB.get(`users:${userid}`, 'json'),
            User,
        );
    }
    if (!user.firstname) {
        user.firstname = wh.message.from.first_name;
        uchanges = true;
    }
    if (!user.lastname) {
        user.lastname = wh.message.from.last_name;
        uchanges = true;
    }
    if (!user.interfaces.telegram) {
        user.interfaces.telegram = {
            id: wh.message.from.id,
            chat: wh.message.chat.id,
            username: wh.message.from.username,
        };
        uchanges = true;
    }
    if (uchanges) {
        await TIMDB.put(`users:${user.uid}`, JSON.stringify(user));
    }
    return user;
}

class OAICompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        text: string;
        index: number;
        logprobs: number;
        finish_reason: string;
    }[];
}


/**
* Performs a GPT-3 completion for a given request.
* @param req The request body to send to OpenAI servers.
*/
export async function OAICompletion(req: {
    prompt: string;
    max_tokens: number;
    temperature: number;
    n: number;
    stop: string[];
}): Promise<string> {
    const url = 'https://api.openai.com/v1/engines/davinci/completions';
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_SECRET}`,
        },
        body: JSON.stringify(req),
    });
    if (response.status != 200) {
        throw new Error(`invalid openai completion response: ${response.status}`);
    }
    const completionResponse = await JSONToObj(
        await response.json(),
        OAICompletionResponse,
    );
    if (completionResponse.choices.length == 0) {
        throw new Error('openai completion request returned no choices');
    }
    return completionResponse.choices[0].text.trim();
}

/**
 * An ActivitySummary gives a summary of activities for a set time measured in hours.
 */
type ActivitySummary = Map<Activity, number>;

/**
 * Time allocations (budgets) for weekdays (Sunday - Thursday) measured in hours.
 * Any non-allocated time is implicity assigned to Activity.Buffer.
 */
var WeekdayTimeAllocations = new Map<Activity, number>([
    [Activity.Sleep, 6.0],
    [Activity.Routines, 1.0],
    [Activity.Meals, 1.0],
    [Activity.Debuild, 8.0],
    [Activity.School, 6.0],
]);

/**
 * Time allocations (budgets) for weekends (Friday - Saturday) measured in hours.
 * Any non-allocated time is implicity assigned to Activity.Buffer.
 */
var WeekendTimeAllocations = new Map<Activity, number>([
    [Activity.Sleep, 6.0],
    [Activity.Routines, 1.0],
    [Activity.Meals, 2.0],
    [Activity.School, 4.0],
    [Activity.Reading, 4.0],
    // Deliberately severely under-allocated to allow for social events. 
]);

/**
 * Extracts the transitioned activity from the users query using GPT.
 * @param query The user query.
 */
async function ExtractActivityTransition(query: string): Promise<Activity> {
    const prompt = `The following is a mapping from a user query and the corresponding new activity that they are doing.

The valid activities are:
- "sleep"
- "routines"
- "meals"
- "debuild"
- "school"
- "reading"
- "buffer"

User Query: Bedtime! goodnight.
Activity: sleep

User Query: starting morning routines.
Activity: routines

User Query: time to cook food
Activity: meals

User Query: working on debuild
Activity: debuild

User Query: gotta do some school work
Activity: school

User Query: time for some reading
Activity: reading

User Query: time for some downtime
Activity: buffer

User Query: its chill time
Activity: buffer

User Query: ${query}
Activity:`
    const response = await OAICompletion({
        prompt: prompt,
        max_tokens: 100,
        temperature: 0.5,
        n: 1,
        stop: ['\n'],
    });
    return response as Activity;
}

/**
 * Extracts relevant information from a user query and produces a structure which describes
 * how the system should act on this query.
 * @param query The user query string.
 */
async function ExtractIntentAndEntities(query: string): Promise<{
    intent: NLIntent,
    activity?: Activity
}> {
    query = query.toLowerCase();
    if (query.includes("summary")) {
        return {
            intent: NLIntent.DailySummary
        }
    } else if (query == "/start") {
        return {
            intent: NLIntent.StartCommand
        }

    }
    // At this point, the intent must be NLIntent.RecordActivitySwitch, meaning the user has
    // transitioned from an one activity to another. We must determine which activity the user
    // has now chosen to transition to. For this, we use a GPT-3 query.
    return {
        intent: NLIntent.RecordActivitySwitch,
        activity: await ExtractActivityTransition(query)
    }
}

/**
 * An NLHandler is used to handle an natural language query.
 */
type NLHandler = (r: NLRequest) => Promise<NLResponse>;

// The number of milliseconds in an hour.
const MSInHour = 60 * 60 * 1000;

/**
 * Get an activity summary of a user for a given day.
 * @param user The user identifier.
 */
async function GetActivitySummaryForDay(user: string): Promise<ActivitySummary> {
    const prefix = `users:${user}:interactions`;
    const searchDate = new Date().setHours(0, 0, 0, 0); // 00:00 today
    // There is a potential issue here that if the addone intent isn't an activity switch,
    // then this will fail horrifically.
    const log = await GetLastPrefixedCounterSet(prefix, NLLog, (v: NLLog): boolean => {
        return v.timestamp > searchDate;
    }, /*addone: */true);
    // Tally up all the times - note that timestamps are stored in milliseconds.
    const summary = new Map<Activity, number>([]);
    for (let i = 0; i < log.length; ++i) {
        if (log[i].meta.intent != NLIntent.RecordActivitySwitch) {
            continue;
        }
        const duration = (((i == log.length - 1) ? (Date.now()) : (log[i + 1].timestamp)) - log[i].timestamp) / MSInHour;
        const activity = log[i].meta.activity!;
        var existing = summary.get(activity);
        if (!existing) {
            existing = 0;
        }
        summary.set(activity, existing + duration);
    }
    return summary;
}

/**
 * Handles the /start command.
 * @param r The user request.
 */
async function NLHandleStartCommand(r: NLRequest): Promise<NLResponse> {
    const response = new NLResponse();
    response.message = "Hello! By default, you are currently on buffered time.";
    return response;
}

/**
 * Gives the user a summary of the day, including how much time they have spent on each
 * activity, whether or not they are on track, and how much time remaining for certain activities.
 * @param r The user request.
 */
async function NLHandleDailySummary(r: NLRequest): Promise<NLResponse> {
    // TODO
    return new NLResponse();
}

/**
 * Returns the current activity of the user.
 * @param user The user identifier.
 */
async function GetUserCurrentActivity(user: string): Promise<Activity> {
    const prefix = `users:${user}:interactions`;
    const last = await GetLastPrefixedCounterValue(prefix, NLLog, (v: NLLog): boolean => {
        return v.meta.intent == NLIntent.RecordActivitySwitch;
    });
    if (last == null) {
        return Activity.Buffer;
    }
    return last.meta.activity!;
}

/**
 * Logs an activity switch between two activities. Since we record time spent 24/7, switching to an
 * activity implies the ending of the other activity. This drastically reduces the number of
 * messages required back and forth.
 * @param r The user request.
 */
async function NLHandleActivitySwitch(r: NLRequest): Promise<NLResponse> {
    const current = await GetUserCurrentActivity(r.user.uid);
    const transitioned = r.activity!;
    const response = new NLResponse();
    if (current == transitioned) {
        response.message = `No change, still on ${current.toString()}.`;
    } else {
        response.message = `Switching from ${current.toString()} to ${transitioned.toString()}.`;
    }
    return response;
}

/**
 * Mappings of Intents to Handlers.
 */
var NLHandlers = new Map<NLIntent, NLHandler>([
    [NLIntent.StartCommand, NLHandleStartCommand],
    [NLIntent.DailySummary, NLHandleDailySummary],
    [NLIntent.RecordActivitySwitch, NLHandleActivitySwitch]
]);

/**
 * The handler for incoming Telegram webhooks.
 * @param req The HTTP POST from Telegram.
 */
export async function TelegramHandler(req: Request): Promise<Response> {
    const wh = await JSONToObj(await req.json(), TelegramWebhook);
    const [user, ie] = await Promise.all([
        LookupTelegramUser(wh),
        ExtractIntentAndEntities(wh.message.text)
    ]);

    // Generate the NLRequest structure and call the appropriate handler.
    const request = new NLRequest();
    request.body = wh.message.text;
    request.user = user;
    if (ie.activity) {
        request.activity = ie.activity;
    }
    const handler = NLHandlers.get(ie.intent);
    if (!handler) {
        throw new Error("invalid handler for intent");
    }
    const response = await handler(request);
    // Log the interaction and send the response to the user.
    const log = new NLLog();
    log.timestamp = Date.now();
    log.request = wh.message.text;
    log.response = response.message;
    log.meta = {
        interface: 'telegram',
        intent: ie.intent,
    };
    if (ie.activity && ie.intent == NLIntent.RecordActivitySwitch) {
        log.meta.activity = ie.activity;
    }
    await Promise.all([
        WritePrefixedCounterValue(`users:${user.uid}:interactions`, JSON.stringify(log)),
        SendTelegramMessage(wh.message.chat.id, response.message)
    ]);
    return new Response();
}