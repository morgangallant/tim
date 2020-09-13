import 'reflect-metadata';
import { plainToClass, Expose, Type, Exclude } from 'class-transformer';
import { ClassType } from 'class-transformer/ClassTransformer';

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

/**
 * Returns the current value of a counter (starts at 1, 0 is reserved) and
 * increments the counter for next use. This operation isn't safe because of
 * the lack of atomic guarentees of the CF Worker key/value store.
 * @param prefix The prefix string of the key.
 * @param inc A boolean which determines whether to increment the counter.
 */
export async function PrefixedCounterValue(
    prefix: string,
    inc: boolean,
): Promise<number> {
    const idxkey = `${prefix}:0`;
    const first = await TIMDB.get(idxkey);
    if (first == null) {
        if (inc) {
            await TIMDB.put(idxkey, '2');
        } else {
            await TIMDB.put(idxkey, '1');
        }
        return 1;
    }
    const idx = +first;
    if (inc) {
        await TIMDB.put(idxkey, (idx + 1).toString());
    }
    return idx;
}

/**
 * Writes a value to a sequence of prefixed counter values.
 * @param prefix The prefix to write to.
 * @param value The value to write.
 */
export async function WritePrefixedCounterValue(
    prefix: string,
    value: string | ReadableStream | ArrayBuffer | FormData,
): Promise<void> {
    const idx = await PrefixedCounterValue(prefix, true);
    return TIMDB.put(`${prefix}:${idx}`, value);
}

/**
 * Get the last prefixed counter value which matches a filter function.
 * @param prefix The prefix to reverse scan.
 * @param t The object to write the values to.
 * @param filter The filtering function to use.
 */
export async function GetLastPrefixedCounterValue<T>(
    prefix: string,
    t: ClassType<T>,
    filter: (v: T) => boolean,
): Promise<T | null> {
    var idx = (await PrefixedCounterValue(prefix, false)) - 1;
    for (; idx > 0; idx--) {
        const val = await TIMDB.get(`${prefix}:${idx}`, 'json');
        if (val == null) {
            break;
        }
        const oval = await JSONToObj(val, t);
        if (filter(oval)) {
            return oval;
        }
    }
    return null;
}

/**
 * Returns a set of the last prefixed counter values which match a filter function. This is
 * essentially a take...while loop in reverse direction.
 * @param prefix The prefix to reverse scan.
 * @param t The object to write the values to.
 * @param filter The filtering function to use.
 */
export async function GetLastPrefixedCounterSet<T>(
    prefix: string,
    t: ClassType<T>,
    filter: (v: T) => boolean,
): Promise<T[] | null> {
    var idx = (await PrefixedCounterValue(prefix, false)) - 1;
    var collect: T[] = [];
    for (; idx > 0; idx--) {
        const val = await TIMDB.get(`${prefix}:${idx}`, 'json');
        if (val == null) {
            break;
        }
        const oval = await JSONToObj(val, t);
        if (!filter(oval)) {
            break;
        }
        collect.push(oval);
    }
    return collect;
}