import 'reflect-metadata';
import { plainToClass, Expose, Type, Exclude } from 'class-transformer';
import { ClassType } from 'class-transformer/ClassTransformer';
import { TSMap } from "typescript-map";

/**
 * JSONToObj is used to map a JSON object into a class type.
 * @param json Any object which can be mapped to JSON.
 * @param out The type for which the JSON will be mapped to.
 */
export async function JSONToObj<T>(json: any, out: ClassType<T>): Promise<T> {
    // By default, the actual JSON body will not be altered in any way and it will
    // just be mapped to the class. Extra fields that isn't a part of the class
    // will still be there when a JSON.stringify occurs. To get rid of this, add
    // an @Exclude() decorator to the entire class then @Expose() all the members
    // that you want to be kept.
    // See GH issue: https://github.com/typestack/routing-controllers/issues/200
    return plainToClass(out, json);
}

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