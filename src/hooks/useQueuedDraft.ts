import { useEffect, useRef, useState } from "react";

/** Immediate local edits with one write in flight. A later edit always builds on
 * the latest draft, and apply/back can await every pending write via flush(). */
export function useQueuedDraft<T>(
  remote: T,
  save: (draft: T) => Promise<unknown>,
) {
  const [value, setValue] = useState(remote);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(remote);
  const remoteValue = useRef(remote);
  const saveRef = useRef(save);
  saveRef.current = save;
  remoteValue.current = remote;
  const revision = useRef(0);
  const saved = useRef(0);
  const dirty = useRef(false);
  const running = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (JSON.stringify(remote) === JSON.stringify(current.current))
      dirty.current = false;
    if (!running.current && !dirty.current) {
      current.current = remote;
      setValue(remote);
    }
  }, [remote]);

  const flush = (): Promise<void> => {
    if (running.current) return running.current;
    if (saved.current === revision.current) return Promise.resolve();
    setPending(true);
    setError(null);
    // Defer the loop so running is assigned even when save throws synchronously.
    const task = Promise.resolve()
      .then(async () => {
        while (saved.current < revision.current) {
          const version = revision.current;
          const snapshot = current.current;
          await saveRef.current(snapshot);
          saved.current = version;
        }
        if (
          JSON.stringify(remoteValue.current) ===
          JSON.stringify(current.current)
        )
          dirty.current = false;
      })
      .catch((e: unknown) => {
        setError(String(e));
        throw e;
      })
      .finally(() => {
        running.current = null;
        setPending(false);
      });
    running.current = task;
    return task;
  };

  const edit = (update: (previous: T) => T) => {
    current.current = update(current.current);
    revision.current += 1;
    dirty.current = true;
    setValue(current.current);
    void flush().catch(() => {}); // keep the draft; the UI offers retry
  };
  return { value, edit, flush, pending, error };
}
