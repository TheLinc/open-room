/**
 * An async generator you can push into after it has started.
 *
 * Streaming input mode requires handing `query()` an `AsyncIterable` up front,
 * but user messages arrive later and unpredictably. This bridges the two: the
 * generator parks on a promise while the queue is empty and resumes when
 * something is pushed.
 *
 * Without this the only alternative is a fresh `query()` per turn, which is
 * single-message mode and cannot support interrupts or in-loop permission
 * prompts.
 */
export class PushableQueue<T> {
  private readonly buffer: T[] = []
  private waiting: ((result: IteratorResult<T>) => void) | null = null
  private closed = false

  push(value: T): void {
    if (this.closed) return

    // A parked consumer takes the value directly; buffering it first would
    // reorder it behind items pushed while the consumer was awake.
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve({ value, done: false })
      return
    }

    this.buffer.push(value)
  }

  /** Ends the stream, which ends the `query()` call consuming it. */
  close(): void {
    if (this.closed) return
    this.closed = true

    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve({ value: undefined as never, done: true })
    }
  }

  get isClosed(): boolean {
    return this.closed
  }

  async *stream(): AsyncGenerator<T> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift() as T
        continue
      }

      if (this.closed) return

      const next = await new Promise<IteratorResult<T>>((resolve) => {
        this.waiting = resolve
      })

      if (next.done) return
      yield next.value
    }
  }
}
