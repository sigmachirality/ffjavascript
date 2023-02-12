/* global WebAssembly */

import BigBuffer from "./bigbuffer"

export type InitTask = {
    cmd: "INIT",
    code: any, // TODO: type this
    init: number
}

export type TerminateTask = {
    cmd: "TERMINATE"
}

export type AllocSetTask = {
    cmd: "ALLOCSET",
    var: number,
    buff: Uint8Array | BigBuffer
}

export type AllocTask = {
    cmd: "ALLOC",
    var: number,
    len: number
}

export type SetTask = {
    cmd: "SET",
    var: number,
    buff: any
}

export type CallTask = {
    cmd: "CALL",
    fnName: string,
    params: any[]
}

export type GetTask = {
    cmd: "GET",
    var: number,
    len: number,
    out: number
}

export type ThreadTask = InitTask | TerminateTask | AllocSetTask | AllocTask | SetTask | CallTask | GetTask;


export default function thread(self?: DedicatedWorkerGlobalScope) {
    const MAXMEM = 32767 as const;
    let instance: {
        exports: { [key: string]: CallableFunction }
    };
    let memory: WebAssembly.Memory;

    if (self) {
        self.onmessage = function (e: ThreadTask[] | MessageEvent<ThreadTask[]>) {
            let data: ThreadTask[];
            if (e instanceof MessageEvent) {
                data = e.data;
            } else {
                data = e;
            }

            if (data[0].cmd === "INIT") {
                const initTask = data[0];
                init(initTask).then(function () {
                    self.postMessage(data.result); //TODO: ???? does this line do
                });
            } else if (data[0].cmd === "TERMINATE") {
                self.close();
            } else {
                const res = runTask(data);
                self.postMessage(res);
            }
        };
    }

    async function init(data: {
        code: any,
        init: number
    }) {
        const code = new Uint8Array(data.code);
        const wasmModule = await WebAssembly.compile(code);
        memory = new WebAssembly.Memory({ initial: data.init, maximum: MAXMEM });

        instance = await WebAssembly.instantiate(wasmModule, {
            env: {
                "memory": memory
            }
        }) as {
            exports: { [key: string]: CallableFunction }
        };
    }



    function alloc(length: number) {
        const u32 = new Uint32Array(memory.buffer, 0, 1);
        while (u32[0] & 3) u32[0]++;  // Return always aligned pointers
        const res = u32[0];
        u32[0] += length;
        if (u32[0] + length > memory.buffer.byteLength) {
            const currentPages = memory.buffer.byteLength / 0x10000;
            let requiredPages = Math.floor((u32[0] + length) / 0x10000) + 1;
            if (requiredPages > MAXMEM) requiredPages = MAXMEM;
            memory.grow(requiredPages - currentPages);
        }
        return res;
    }

    function allocBuffer(buffer: Uint8Array | BigBuffer) {
        const p = alloc(buffer.byteLength);
        setBuffer(p, buffer);
        return p;
    }

    function getBuffer(pointer: number = 0, length?: number) {
        const u8 = new Uint8Array(memory.buffer);
        return new Uint8Array(u8.buffer, u8.byteOffset + pointer, length);
    }

    function setBuffer(pointer: number, buffer: any) {
        const u8 = new Uint8Array(memory.buffer);
        u8.set(new Uint8Array(buffer), pointer);
    }

    function runTask(task: ThreadTask[]) {
        if (task[0].cmd === "INIT") {
            return init(task[0]);
        }
        const ctx = {
            vars: [] as number[],
            out: [] as Uint8Array[]
        };
        const u32a = new Uint32Array(memory.buffer, 0, 1);
        const oldAlloc = u32a[0];
        for (let i = 0; i < task.length; i++) {
            switch (task[i].cmd) {
                case "ALLOCSET":
                    const allocSetTask = task[i] as AllocSetTask;
                    ctx.vars[allocSetTask.var] = allocBuffer(allocSetTask.buff);
                    break;
                case "ALLOC":
                    const allocTask = task[i] as AllocTask;
                    ctx.vars[allocTask.var] = alloc(allocTask.len);
                    break;
                case "SET":
                    const setTask = task[i] as SetTask;
                    setBuffer(ctx.vars[setTask.var], setTask.buff);
                    break;
                case "CALL": {
                    const params = [];
                    const callTask = task[i] as CallTask;
                    for (let j = 0; j < callTask.params.length; j++) {
                        const p = callTask.params[j];
                        if (typeof p.var !== "undefined") {
                            params.push(ctx.vars[p.var] + (p.offset || 0));
                        } else if (typeof p.val != "undefined") {
                            params.push(p.val);
                        }
                    }
                    instance.exports[callTask.fnName](...params);
                    break;
                }
                case "GET":
                    const getTask = task[i] as GetTask;
                    ctx.out[getTask.out] = getBuffer(ctx.vars[getTask.var], getTask.len).slice();
                    break;
                default:
                    throw new Error("Invalid cmd");
            }
        }
        const u32b = new Uint32Array(memory.buffer, 0, 1);
        u32b[0] = oldAlloc;
        return ctx.out;
    }


    return runTask;
}
