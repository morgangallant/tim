export class User {
    uid: string;
    firstname?: string;
    lastname?: string;
    email?: string;
    interfaces: {
        telegram?: {
            id: number;
            chat: number;
            username: string;
        }
    };
}

export enum Activity {
    Sleep = "sleep",
    Routines = "routines",
    Meals = "meals",
    Debuild = "debuild",
    School = "school",
    Reading = "reading",
    Buffer = "buffer"
}

export class NLRequest {
    user: User;
    body: string;
    activity?: Activity;
}

export class NLResponse {
    message: string;
}

export enum NLIntent {
    StartCommand = "start-cmd",
    DailySummary = "day-summary",
    RecordActivitySwitch = "activity-switch"
}

export class NLLog {
    timestamp: number;
    request: string;
    response: string;
    meta: {
        interface: string;
        intent: NLIntent;
        activity?: Activity;
    };
}