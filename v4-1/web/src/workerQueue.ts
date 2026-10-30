/**
 * Requests to a worker, one at a time: asked again while it's busy, the newest waits (replacing any older still
 * waiting), so slow work never falls behind the playhead. The worker answers each message with one of its own.
 */
export class WorkerQueue<Request, Answer> {
  private worker: Worker
  private busy: ((answer: Answer) => void) | null = null
  private waiting: { request: Request; transfer: Transferable[]; onAnswer: (answer: Answer) => void } | null = null

  constructor(worker: Worker) {
    this.worker = worker
    worker.onmessage = (e: MessageEvent<Answer>) => {
      const done = this.busy
      this.busy = null
      done?.(e.data)
      const next = this.waiting
      this.waiting = null
      if (next) this.request(next.request, next.transfer, next.onAnswer)
    }
  }

  request(request: Request, transfer: Transferable[], onAnswer: (answer: Answer) => void) {
    if (this.busy) {
      this.waiting = { request, transfer, onAnswer }
      return
    }
    this.busy = onAnswer
    this.worker.postMessage(request, transfer)
  }

  close() {
    this.worker.terminate()
    this.busy = this.waiting = null
  }
}
