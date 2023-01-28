
/* global BigInt */
const hexLen = [0, 1, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4] as const;

export type Radix = 10 | 10n | 16 | 16n;
export type BigIntish = Parameters<typeof BigInt>[0];
export type BigIntStringish = Pick<BigInt, "toString">;

export function fromString(s: BigIntish, radix: Radix = 10) {
    if (radix == 10) {
        return BigInt(s);
    } else if (radix == 16) {
        if (typeof s === 'string' && !s.startsWith("0x")) {
            s = "0x" + s;
        }
        return BigInt(s);
    }
    return BigInt(s);
}

export const e = fromString;

export function fromArray(a: BigIntish[], radix: BigIntish) {
    let acc = BigInt(0);
    radix = BigInt(radix);
    for (let i = 0; i < a.length; i++) {
        acc = acc * radix + BigInt(a[i]);
    }
    return acc;
}

export function bitLength(a: BigIntStringish) {
    const aS = a.toString(16);
    return (aS.length - 1) * 4 + hexLen[parseInt(aS[0], 16)];
}

export function isNegative(a: BigIntish) {
    return BigInt(a) < BigInt(0);
}

export function isZero(a: Exclude<BigIntish, string>) {
    return !a;
}

export function shiftLeft(a: BigIntish, n: BigIntish) {
    return BigInt(a) << BigInt(n);
}

export function shiftRight(a: BigIntish, n: BigIntish) {
    return BigInt(a) >> BigInt(n);
}

export const shl = shiftLeft;
export const shr = shiftRight;

export function isOdd(a: BigIntish) {
    return (BigInt(a) & BigInt(1)) == BigInt(1);
}


export function naf(n: BigIntish) {
    let E = BigInt(n);
    const res = [];
    while (E) {
        if (E & BigInt(1)) {
            const z = 2 - Number(E % BigInt(4));
            res.push(z);
            E = E - BigInt(z);
        } else {
            res.push(0);
        }
        E = E >> BigInt(1);
    }
    return res;
}


export function bits(n: BigIntish) {
    let E = BigInt(n);
    const res = [];
    while (E) {
        if (E & BigInt(1)) {
            res.push(1);
        } else {
            res.push(0);
        }
        E = E >> BigInt(1);
    }
    return res as (0 | 1)[];
}

export function toNumber(s: BigIntish) {
    if (s > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("Number too big");
    }
    return Number(s);
}

export function toArray(s: string, radix: Radix) {
    const res = [];
    let rem = BigInt(s);
    const r = BigInt(radix);
    while (rem) {
        res.unshift(Number(rem % r));
        rem = rem / r;
    }
    return res;
}


export function add(a: BigIntish, b: BigIntish) {
    return BigInt(a) + BigInt(b);
}

export function sub(a: BigIntish, b: BigIntish) {
    return BigInt(a) - BigInt(b);
}

export function neg(a: BigIntish) {
    return -BigInt(a);
}

export function mul(a: BigIntish, b: BigIntish) {
    return BigInt(a) * BigInt(b);
}

export function square(a: BigIntish) {
    return BigInt(a) * BigInt(a);
}

export function pow(a: BigIntish, b: BigIntish) {
    return BigInt(a) ** BigInt(b);
}

export function exp(a: BigIntish, b: BigIntish) {
    return BigInt(a) ** BigInt(b);
}

export function abs(a: BigIntish) {
    return BigInt(a) >= 0 ? BigInt(a) : -BigInt(a);
}

export function div(a: BigIntish, b: BigIntish) {
    return BigInt(a) / BigInt(b);
}

export function mod(a: BigIntish, b: BigIntish) {
    return BigInt(a) % BigInt(b);
}

export function eq(a: BigIntish, b: BigIntish) {
    return BigInt(a) == BigInt(b);
}

export function neq(a: BigIntish, b: BigIntish) {
    return BigInt(a) != BigInt(b);
}

export function lt(a: BigIntish, b: BigIntish) {
    return BigInt(a) < BigInt(b);
}

export function gt(a: BigIntish, b: BigIntish) {
    return BigInt(a) > BigInt(b);
}

export function leq(a: BigIntish, b: BigIntish) {
    return BigInt(a) <= BigInt(b);
}

export function geq(a: BigIntish, b: BigIntish) {
    return BigInt(a) >= BigInt(b);
}

export function band(a: BigIntish, b: BigIntish) {
    return BigInt(a) & BigInt(b);
}

export function bor(a: BigIntish, b: BigIntish) {
    return BigInt(a) | BigInt(b);
}

export function bxor(a: BigIntish, b: BigIntish) {
    return BigInt(a) ^ BigInt(b);
}

export function land(a: BigIntish, b: BigIntish) {
    return BigInt(a) && BigInt(b);
}

export function lor(a: BigIntish, b: BigIntish) {
    return BigInt(a) || BigInt(b);
}

export function lnot(a: BigIntish) {
    return !BigInt(a);
}

// Returns a buffer with Little Endian Representation
export function toRprLE(buff: Uint8Array, o: number, e: BigIntStringish & BigIntish, n8: number) {
    const s = "0000000" + e.toString(16);
    const v = new Uint32Array(buff.buffer, o, n8 / 4);
    const l = (((s.length - 7) * 4 - 1) >> 5) + 1;    // Number of 32bit words;
    for (let i = 0; i < l; i++) v[i] = parseInt(s.substring(s.length - 8 * i - 8, s.length - 8 * i), 16);
    for (let i = l; i < v.length; i++) v[i] = 0;
    for (let i = v.length * 4; i < n8; i++) buff[i] = toNumber(band(shiftRight(e, i * 8), 0xFF));
}

// Returns a buffer with Big Endian Representation
export function toRprBE(buff: Uint8Array, o: number, e: BigIntStringish, n8: number) {
    const s = "0000000" + e.toString(16);
    const v = new DataView(buff.buffer, buff.byteOffset + o, n8);
    const l = (((s.length - 7) * 4 - 1) >> 5) + 1;    // Number of 32bit words;
    for (let i = 0; i < l; i++) v.setUint32(n8 - i * 4 - 4, parseInt(s.substring(s.length - 8 * i - 8, s.length - 8 * i), 16), false);
    for (let i = 0; i < n8 / 4 - l; i++) v.setUint8(i, 0);
}

// Pases a buffer with Little Endian Representation
export function fromRprLE(buff: Uint8Array, o: number = 0, n8: number = buff.byteLength) {
    const v = new Uint32Array(buff.buffer, o, n8 / 4);
    const a = new Array(n8 / 4);
    v.forEach((ch, i) => a[a.length - i - 1] = ch.toString(16).padStart(8, "0"));
    return fromString(a.join(""), 16);
}

// Pases a buffer with Big Endian Representation
export function fromRprBE(buff: Uint8Array, o: number = 0, n8: number = buff.byteLength) {
    const v = new DataView(buff.buffer, buff.byteOffset + o, n8);
    const a = new Array(n8 / 4);
    for (let i = 0; i < n8 / 4; i++) {
        a[i] = v.getUint32(i * 4, false).toString(16).padStart(8, "0");
    }
    return fromString(a.join(""), 16);
}

export function toString(a: BigIntStringish, radix?: Radix) {
    return a.toString(radix as number);
}

export function toLEBuff(a: BigIntStringish & BigIntish) {
    const buff = new Uint8Array(Math.floor((bitLength(a) - 1) / 8) + 1);
    toRprLE(buff, 0, a, buff.byteLength);
    return buff;
}

export const zero = e(0);
export const one = e(1);





