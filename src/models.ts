import { TSMap } from "typescript-map";

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

export class NLRequest {
    user: User;
    body: string;
    entities: TSMap<string, any>;
}

export class NLResponse {
    message: string;
    context?: TSMap<string, any>;
}

export enum NLIntent {
    DailySummary = "day-summary",
    RecordActivitySwitch = "activity-switch"
}

export enum Activity {
    Sleep = "sleep",
    Routines = "routines",
    Meals = "meals",
    Debuild = "debuild",
    School = "school",
    Reading = "reading",
    Buffer = "other"
}

export class NLLog {
    timestamp: number;
    request: string;
    response: string;
    meta: {
        interface: string;
        intent: NLIntent;
        newActivity?: Activity;
    };
}