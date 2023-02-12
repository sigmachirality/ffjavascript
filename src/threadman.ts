/* global navigator, WebAssembly */
/*
    Copyright 2019 0KIMS association.

    This file is part of wasmsnark (Web Assembly zkSnark Prover).

    wasmsnark is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    wasmsnark is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with wasmsnark. If not, see <https://www.gnu.org/licenses/>.
*/

// const MEM_SIZE = 1000;  // Memory size in 64K Pakes (512Mb)
const MEM_SIZE = 25;  // Memory size in 64K Pakes (1600Kb)


import thread, { ThreadTask } from "./threadman_thread.js";
import { cpus as osCPUs } from "os";
import Worker from "web-worker";

class Deferred<Ret = any, Err = any> {
  promise: Promise<Ret>;
  reject!: (reason: Err) => void;
  resolve!: (value: Ret | PromiseLike<Ret>) => void;

  constructor() {
    this.promise = new Promise<Ret>((resolve, reject) => {
      this.reject = reject;
      this.resolve = resolve;
    });
  }
}

function sleep(ms: number) {
  return new Promise<NodeJS.Timeout>(resolve => setTimeout(resolve, ms));
}

function stringToBase64(str: string) {
  if ((process as any).browser) {
    return globalThis.btoa(str);
  } else {
    return Buffer.from(str).toString("base64");
  }
}

const threadSource = stringToBase64("(" + thread.toString() + ")(self)");
const workerSource = "data:application/javascript;base64," + threadSource;


type InitalizedThreadManager = SimpleThreadManager | ConcurrentThreadManager;

export default async function buildThreadManager(wasm: unknown, singleThread: boolean):
Promise<SimpleThreadManager | ConcurrentThreadManager> {
  const tm = new ThreadManager();

  tm.memory = new WebAssembly.Memory({ initial: MEM_SIZE });
  tm.u8 = new Uint8Array(tm.memory.buffer);
  tm.u32 = new Uint32Array(tm.memory.buffer);

  const wasmModule = await WebAssembly.compile(wasm.code);

  tm.instance = await WebAssembly.instantiate(wasmModule, {
    env: {
      "memory": tm.memory
    }
  });

  tm.singleThread = singleThread;
  tm.initalPFree = tm.u32[0];   // Save the Pointer to free space.
  tm.pq = wasm.pq;
  tm.pr = wasm.pr;
  tm.pG1gen = wasm.pG1gen;
  tm.pG1zero = wasm.pG1zero;
  tm.pG2gen = wasm.pG2gen;
  tm.pG2zero = wasm.pG2zero;
  tm.pOneT = wasm.pOneT;

  //    tm.pTmp0 = tm.alloc(curve.G2.F.n8*3);
  //    tm.pTmp1 = tm.alloc(curve.G2.F.n8*3);


  if (singleThread) {
    const _tm = tm as SimpleThreadManager;
    _tm.code = wasm.code;
    _tm.taskManager = thread();
    await _tm.taskManager([{
      cmd: "INIT",
      init: MEM_SIZE,
      code: _tm.code.slice()
    }]);
    _tm.concurrency = 1;
    return _tm;
  } else {
    const _tm = tm as ConcurrentThreadManager;
    _tm.workers = [];
    _tm.pendingDeferreds = [];
    _tm.working = [];

    function getOnMsg(i: number) {
      return function (e: any) {
        let data;
        if ((e) && (e.data)) {
          data = e.data;
        } else {
          data = e;
        }
  
        _tm.working[i] = false;
        _tm.pendingDeferreds[i].resolve(data);
        _tm.processWorks();
      };
    }

    let concurrency;

    if ((typeof (navigator) === "object") && navigator.hardwareConcurrency) {
      concurrency = navigator.hardwareConcurrency;
    } else {
      concurrency = osCPUs().length;
    }

    if (concurrency == 0) {
      concurrency = 2;
    }

    // Limit to 64 threads for memory reasons.
    if (concurrency > 64) concurrency = 64;
    _tm.concurrency = concurrency;

    for (let i = 0; i < concurrency; i++) {

      _tm.workers[i] = new Worker(workerSource);

      _tm.workers[i].addEventListener("message", getOnMsg(i));

      _tm.working[i] = false;
    }

    const initPromises = [];
    for (let i = 0; i < _tm.workers.length; i++) {
      const copyCode = wasm.code.slice();
      initPromises.push(tm.postAction(i, [{
        cmd: "INIT",
        init: MEM_SIZE,
        code: copyCode
      }], [copyCode.buffer]));
    }

    await Promise.all(initPromises);
    return _tm;
  }
}

type SimpleThreadManager = Required<ThreadManager> & {
  code: unknown;
  taskManager: ReturnType<typeof thread>;
};

type ConcurrentThreadManager = Required<ThreadManager> & {
  workers: Worker[];
  pendingDeferreds: Deferred[];
  working: boolean[];
};

// TODO: split this into two seperate classes, simple ThreadManager and ConcurrentThreadManager,
// which extend ThreadManager
class ThreadManager {

  // initialized in constructor
  actionQueue: {
    data: ThreadTask[],
    transfers: any,
    deferred: Deferred;
  }[]
  oldPFree: number;

  // initialized in builder
  memory?: WebAssembly.Memory;
  u8?: Uint8Array;
  u32?: Uint32Array;
  instance?: WebAssembly.Instance;
  singleThread?: boolean;
  initalPFree?: number;

  // TODO: type these based on WasmCurve from wasm_curve
  pq: unknown;
  pr: unknown;
  pG1gen: unknown;
  pG1zero: unknown;
  pG2zero: unknown;
  pG2gen: unknown;
  pOneT: unknown;

  concurrency?: number;

  constructor() {
    this.actionQueue = [];
    this.oldPFree = 0;
  }

  startSyncOp() {
    if (!this.u32) throw new Error("ThreadManager uninitialized");
    if (this.oldPFree != 0) throw new Error("Sync operation in progress");
    this.oldPFree = this.u32[0];
  }

  endSyncOp() {
    if (!this.u32) throw new Error("ThreadManager uninitialized");
    if (this.oldPFree == 0) throw new Error("No sync operation in progress");
    this.u32[0] = this.oldPFree;
    this.oldPFree = 0;
  }

  postAction(workerId: number, e: any, transfers: any, _deferred?: Deferred) {
    if (this.singleThread) throw Error("this is a singlethreaded threadmanager");
    
    const _tm = this as unknown as ConcurrentThreadManager;
    if (_tm.working[workerId]) {
      throw new Error("Posting a job t a working worker");
    }
    _tm.working[workerId] = true;

    _tm.pendingDeferreds[workerId] = _deferred ? _deferred : new Deferred();
    _tm.workers[workerId].postMessage(e, transfers);

    const ret = _tm.pendingDeferreds[workerId];
    return ret.promise;
  }

  processWorks() {
    if (this.singleThread) throw Error("this is a singlethreaded threadmanager");

    const _tm = this as unknown as ConcurrentThreadManager;
    for (let i = 0; (i < _tm.workers.length) && (this.actionQueue.length > 0); i++) {
      if (_tm.working[i] == false) {
        const work = this.actionQueue.shift();
        this.postAction(i, work?.data, work?.transfers, work?.deferred);
      }
    }
  }

  queueAction(actionData: ThreadTask[], transfers: any) {
    const d = new Deferred();

    if (this.singleThread) {
      const _tm = this as unknown as SimpleThreadManager;
      const res = _tm.taskManager(actionData);
      d.resolve(res);
    } else {
      const _tm = this as unknown as ConcurrentThreadManager;
      _tm.actionQueue.push({
        data: actionData,
        transfers: transfers,
        deferred: d
      });
      _tm.processWorks();
    }
    return d.promise;
  }

  resetMemory() {
    if (!this.u32 || !this.initalPFree) throw new Error("ThreadManager uninitialized");
    this.u32[0] = this.initalPFree;
  }

  allocBuff(buff: ArrayBufferLike) {
    const pointer = this.alloc(buff.byteLength);
    this.setBuff(pointer, buff);
    return pointer;
  }

  getBuff(pointer: number, length: number) {
    if (!this.u8) throw new Error("ThreadManager uninitialized");
    return this.u8.slice(pointer, pointer + length);
  }

  setBuff(pointer: number, buffer:  ArrayLike<number> | ArrayBufferLike) {
    if (!this.u8) throw new Error("ThreadManager uninitialized");
    this.u8.set(new Uint8Array(buffer), pointer);
  }

  alloc(length: number) {
    if (!this.u32) throw new Error("ThreadManager uninitialized");
    while (this.u32[0] & 3) this.u32[0]++;  // Return always aligned pointers
    const res = this.u32[0];
    this.u32[0] += length;
    return res;
  }

  async terminate() {
    if (this.singleThread) throw Error("this is a singlethreaded threadmanager");
    const _tm = this as unknown as ConcurrentThreadManager;
    for (let i = 0; i < _tm.workers.length; i++) {
      _tm.workers[i].postMessage([{ cmd: "TERMINATE" }]);
    }
    await sleep(200);
  }

}
