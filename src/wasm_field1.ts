import * as Scalar from "./scalar.js";
import * as utils from "./utils.js";
import { getThreadRng } from "./random.js";
import buildBatchConvert, { BatchConvert } from "./engine_batchconvert.js";
import BigBuffer from "./bigbuffer.js";

import type { ThreadManager } from "./threadman";
import type { WasmF1Element } from "./types/field.js";
import ChaCha from "./chacha.js";

type Bufferish = ArrayLike<number> | ArrayBufferLike;

export default class WasmField1 {
    tm: ThreadManager;
    prefix: string;

    type: "F1";
    one: Uint8Array;
    zero: Uint8Array;
    p: bigint;
    m: 1;
    negone: Uint8Array;
    two: Uint8Array;
    half: bigint;
    bitLength: number;
    mask: bigint;

    n64: number;
    n32: number;
    n8: number;
    nqr: Uint8Array;
    s: number;

    pOp1: number;
    pOp2: number;
    pOp3: number;

    shift: Uint8Array;
    shiftInv: Uint8Array;

    w: Uint8Array[];

    batchToMontgomery: BatchConvert;
    batchFromMontgomery: BatchConvert;


    constructor(tm: ThreadManager, prefix: string, n8: number, p: bigint) {
        this.tm = tm;
        this.prefix = prefix;

        this.p = p;
        this.n8 = n8;
        this.type = "F1";
        this.m = 1;

        this.half = Scalar.shiftRight(p, Scalar.one);
        this.bitLength = Scalar.bitLength(p);
        this.mask = Scalar.sub(Scalar.shiftLeft(Scalar.one, this.bitLength), Scalar.one);

        this.pOp1 = tm.alloc(n8);
        this.pOp2 = tm.alloc(n8);
        this.pOp3 = tm.alloc(n8);
        this.tm.instance.exports[prefix + "_zero"](this.pOp1);
        this.zero = this.tm.getBuff(this.pOp1, this.n8);
        this.tm.instance.exports[prefix + "_one"](this.pOp1);
        this.one = this.tm.getBuff(this.pOp1, this.n8);

        this.negone = this.neg(this.one);
        this.two = this.add(this.one, this.one);

        this.n64 = Math.floor(n8 / 8);
        this.n32 = Math.floor(n8 / 4);

        if (this.n64 * 8 != this.n8) {
            throw new Error("n8 must be a multiple of 8");
        }

        this.half = Scalar.shiftRight(this.p, Scalar.one);
        this.nqr = this.two;
        let r = this.exp(this.nqr, this.half);
        while (!this.eq(r, this.negone)) {
            this.nqr = this.add(this.nqr, this.one);
            r = this.exp(this.nqr, this.half);
        }

        this.shift = this.mul(this.nqr, this.nqr);
        this.shiftInv = this.inv(this.shift);

        this.s = 0;
        let t = Scalar.sub(this.p, Scalar.one);

        while (!Scalar.isOdd(t)) {
            this.s = this.s + 1;
            t = Scalar.shiftRight(t, Scalar.one);
        }

        this.w = [];
        this.w[this.s] = this.exp(this.nqr, t);

        for (let i = this.s - 1; i >= 0; i--) {
            this.w[i] = this.square(this.w[i + 1]);
        }

        if (!this.eq(this.w[0], this.one)) {
            throw new Error("Error calculating roots of unity");
        }

        this.batchToMontgomery = buildBatchConvert(tm, prefix + "_batchToMontgomery", this.n8, this.n8);
        this.batchFromMontgomery = buildBatchConvert(tm, prefix + "_batchFromMontgomery", this.n8, this.n8);
    }


    op2(opName: string, a: Bufferish, b: Bufferish) {
        this.tm.setBuff(this.pOp1, a);
        this.tm.setBuff(this.pOp2, b);
        this.tm.instance.exports[this.prefix + opName](this.pOp1, this.pOp2, this.pOp3);
        return this.tm.getBuff(this.pOp3, this.n8);
    }

    op2Bool(opName: string, a: Bufferish, b: Bufferish) {
        this.tm.setBuff(this.pOp1, a);
        this.tm.setBuff(this.pOp2, b);
        return !!this.tm.instance.exports[this.prefix + opName](this.pOp1, this.pOp2);
    }

    op1(opName: string, a: Bufferish) {
        this.tm.setBuff(this.pOp1, a);
        this.tm.instance.exports[this.prefix + opName](this.pOp1, this.pOp3);
        return this.tm.getBuff(this.pOp3, this.n8);
    }

    op1Bool(opName: string, a: Bufferish) {
        this.tm.setBuff(this.pOp1, a);
        return !!this.tm.instance.exports[this.prefix + opName](this.pOp1, this.pOp3);
    }

    add(a: Bufferish, b: Bufferish) {
        return this.op2("_add", a, b);
    }


    eq(a: Bufferish, b: Bufferish) {
        return this.op2Bool("_eq", a, b);
    }

    isZero(a: Bufferish) {
        return this.op1Bool("_isZero", a);
    }

    sub(a: Bufferish, b: Bufferish) {
        return this.op2("_sub", a, b);
    }

    neg(a: Bufferish) {
        return this.op1("_neg", a);
    }

    inv(a: Bufferish) {
        return this.op1("_inverse", a);
    }

    toMontgomery(a: Bufferish) {
        return this.op1("_toMontgomery", a);
    }

    fromMontgomery(a: Bufferish) {
        return this.op1("_fromMontgomery", a);
    }

    mul(a: Bufferish, b: Bufferish) {
        return this.op2("_mul", a, b);
    }

    div(a: Bufferish, b: Bufferish) {
        this.tm.setBuff(this.pOp1, a);
        this.tm.setBuff(this.pOp2, b);
        this.tm.instance.exports[this.prefix + "_inverse"](this.pOp2, this.pOp2);
        this.tm.instance.exports[this.prefix + "_mul"](this.pOp1, this.pOp2, this.pOp3);
        return this.tm.getBuff(this.pOp3, this.n8);
    }

    square(a: Bufferish) {
        return this.op1("_square", a);
    }

    isSquare(a: Bufferish) {
        return this.op1Bool("_isSquare", a);
    }

    sqrt(a: Bufferish) {
        return this.op1("_sqrt", a);
    }

    exp(a: Bufferish, b: bigint | Uint8Array) {
        if (!(b instanceof Uint8Array)) {
            b = Scalar.toLEBuff(Scalar.e(b));
        }
        this.tm.setBuff(this.pOp1, a);
        this.tm.setBuff(this.pOp2, b);
        this.tm.instance.exports[this.prefix + "_exp"](this.pOp1, this.pOp2, b.byteLength, this.pOp3);
        return this.tm.getBuff(this.pOp3, this.n8);
    }

    isNegative(a: Bufferish) {
        return this.op1Bool("_isNegative", a);
    }

    e(a: Uint8Array | Scalar.BigIntish, b?: Scalar.Radix) {
        if (a instanceof Uint8Array) return a;
        let ra = Scalar.e(a, b);
        if (Scalar.isNegative(ra)) {
            ra = Scalar.neg(ra);
            if (Scalar.gt(ra, this.p)) {
                ra = Scalar.mod(ra, this.p);
            }
            ra = Scalar.sub(this.p, ra);
        } else {
            if (Scalar.gt(ra, this.p)) {
                ra = Scalar.mod(ra, this.p);
            }
        }
        const buff = utils.leInt2Buff(ra, this.n8);
        return this.toMontgomery(buff);
    }

    toString(a: Bufferish, radix?: Scalar.Radix) {
        const an = this.fromMontgomery(a);
        const s = Scalar.fromRprLE(an, 0);
        return Scalar.toString(s, radix);
    }

    fromRng(rng: ChaCha) {
        let v;
        const buff = new Uint8Array(this.n8);
        do {
            v = Scalar.zero;
            for (let i = 0; i < this.n64; i++) {
                v = Scalar.add(v, Scalar.shiftLeft(rng.nextU64(), 64 * i));
            }
            v = Scalar.band(v, this.mask);
        } while (Scalar.geq(v, this.p));
        Scalar.toRprLE(buff, 0, v, this.n8);
        return buff;
    }

    random() {
        return this.fromRng(getThreadRng());
    }

    toObject(a: Bufferish) {
        const an = this.fromMontgomery(a);
        return Scalar.fromRprLE(an, 0);
    }

    fromObject(a: Scalar.BigIntish) {
        const buff = new Uint8Array(this.n8);
        Scalar.toRprLE(buff, 0, a, this.n8);
        return this.toMontgomery(buff);
    }

    toRprLE(buff: WasmF1Element, offset: number, a: Bufferish) {
        buff.set(this.fromMontgomery(a), offset);
    }

    toRprBE(buff: WasmF1Element, offset: number, a: Bufferish) {
        const buff2 = this.fromMontgomery(a);
        for (let i = 0; i < this.n8 / 2; i++) {
            const aux = buff2[i];
            buff2[i] = buff2[this.n8 - 1 - i];
            buff2[this.n8 - 1 - i] = aux;
        }
        buff.set(buff2, offset);
    }

    fromRprLE(buff: ArrayBufferLike, offset: number) {
        offset = offset || 0;
        const res = buff.slice(offset, offset + this.n8);
        return this.toMontgomery(res);
    }

    batchInverse(buffIn: Uint8Array): Promise<Uint8Array>;
    batchInverse(buffIn: Uint8Array): Promise<Uint8Array>;
    batchInverse(buffIn: BigBuffer): Promise<BigBuffer>;
    async batchInverse(buffIn: Uint8Array | Uint8Array[] | BigBuffer): Promise<WasmF1Element | WasmF1Element[]> {
        let returnArray = false;
        const sIn = this.n8;
        const sOut = this.n8;

        if (Array.isArray(buffIn)) {
            buffIn = utils.array2buffer(buffIn, sIn);
            returnArray = true;
        } else {
            buffIn = buffIn.slice(0, buffIn.byteLength)!;
        }

        const nPoints = Math.floor(buffIn.byteLength / sIn);
        if (nPoints * sIn !== buffIn.byteLength) {
            throw new Error("Invalid buffer size");
        }
        const pointsPerChunk = Math.floor(nPoints / this.tm.concurrency!);
        const opPromises = [];
        for (let i = 0; i < this.tm.concurrency!; i++) {
            let n;
            if (i < this.tm.concurrency! - 1) {
                n = pointsPerChunk;
            } else {
                n = nPoints - i * pointsPerChunk;
            }
            if (n == 0) continue;

            const buffChunk = buffIn.slice(i * pointsPerChunk * sIn, i * pointsPerChunk * sIn + n * sIn);
            const task = [
                { cmd: "ALLOCSET", var: 0, buff: buffChunk },
                { cmd: "ALLOC", var: 1, len: sOut * n },
                {
                    cmd: "CALL", fnName: this.prefix + "_batchInverse", params: [
                        { var: 0 },
                        { val: sIn },
                        { val: n },
                        { var: 1 },
                        { val: sOut },
                    ]
                },
                { cmd: "GET", out: 0, var: 1, len: sOut * n },
            ];
            opPromises.push(
                this.tm.queueAction(task)
            );
        }

        const result = await Promise.all(opPromises);

        let fullBuffOut;
        if (buffIn instanceof BigBuffer) {
            fullBuffOut = new BigBuffer(nPoints * sOut);
        } else {
            fullBuffOut = new Uint8Array(nPoints * sOut);
        }

        let p = 0;
        for (let i = 0; i < result.length; i++) {
            fullBuffOut.set(result[i][0], p);
            p += result[i][0].byteLength;
        }

        if (returnArray) {
            return utils.buffer2array(fullBuffOut as Uint8Array, sOut);
        } else {
            return fullBuffOut;
        }

    }

}


