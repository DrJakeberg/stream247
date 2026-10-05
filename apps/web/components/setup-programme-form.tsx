"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { describeTemplateReplaceConfirmation } from "@/components/programming-template-form";
import { Input } from "@/components/ui/Input";
import { createFirstProgramme, type FirstProgrammePool } from "@/lib/setup-first-programme";

export type SetupProgrammeSource = {
  id: string;
  name: string;
  readyCount: number;
};

/**
 * The wizard's "First programme" step (M99, U2): a pool from the media the owner picks, then the
 * "Always-on single pool" template over it, so the week plays around the clock. Both go through the
 * routes the Pools and Schedule tabs use; a pool is made from sources, so the picks are sources with
 * their count of ready videos.
 */
export function SetupProgrammeForm(props: {
  sources: SetupProgrammeSource[];
  scheduleBlockCount: number;
  /** Undated blocks among them: the template's all-day blocks overlap these unless the week is replaced (R17). */
  weeklyBlockCount?: number;
}) {
  const playable = props.sources.filter((source) => source.readyCount > 0);
  const weeklyBlockCount = props.weeklyBlockCount ?? props.scheduleBlockCount;
  const [name, setName] = useState("Programme");
  const [selected, setSelected] = useState<string[]>(playable.map((source) => source.id));
  const [replaceWeek, setReplaceWeek] = useState(false);
  // A pool an earlier press created, used again by the next press (lib/setup-first-programme.ts).
  const [createdPool, setCreatedPool] = useState<FirstProgrammePool | null>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (playable.length === 0) {
    return null;
  }

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        if (selected.length === 0) {
          setError("Pick at least one source.");
          return;
        }
        // The same question the Schedule tab's template form asks before it deletes the week (M97, U6).
        if (replaceWeek && props.scheduleBlockCount > 0 && !window.confirm(describeTemplateReplaceConfirmation(props.scheduleBlockCount))) {
          return;
        }

        startTransition(async () => {
          const result = await createFirstProgramme({
            name,
            sourceIds: selected,
            replaceWeek,
            weeklyBlockCount,
            createdPool,
            fetch: (input, init) => fetch(input, init)
          });
          setCreatedPool(result.pool);
          if (result.status === "error") {
            setError(result.message);
            if (result.pool) {
              router.refresh();
            }
            return;
          }

          router.replace("/setup");
          router.refresh();
        });
      }}
    >
      <Input
        hint="A pool is a playlist the schedule plays from. You can rename it later under Program → Pools."
        label="Pool name"
        maxLength={120}
        onChange={setName}
        required
        value={name}
      />
      <div className="stack-form">
        <span className="label">Media to play</span>
        <div className="chip-grid">
          {playable.map((source) => {
            const checked = selected.includes(source.id);
            return (
              <label className={`chip-toggle${checked ? " chip-toggle-active" : ""}`} key={source.id}>
                <input
                  checked={checked}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked ? [...current, source.id] : current.filter((id) => id !== source.id)
                    )
                  }
                  type="checkbox"
                />
                <span>
                  {source.name} · {source.readyCount} ready video{source.readyCount === 1 ? "" : "s"}
                </span>
              </label>
            );
          })}
        </div>
      </div>
      {props.scheduleBlockCount > 0 ? (
        <div>
          <label className={`chip-toggle${replaceWeek ? " chip-toggle-active" : ""}`}>
            <input checked={replaceWeek} onChange={(event) => setReplaceWeek(event.target.checked)} type="checkbox" />
            <span>Replace the blocks already in the week</span>
          </label>
          <span className="field-hint">
            The week has {props.scheduleBlockCount} block{props.scheduleBlockCount === 1 ? "" : "s"}.{" "}
            {weeklyBlockCount > 0
              ? "The new all-day blocks overlap its weekly blocks, so the week is filled only with this ticked."
              : "Without this its dated blocks stay and take the air at their times."}
          </span>
        </div>
      ) : null}
      <p className="subtle">
        Every day from 00:00 to 24:00 plays this pool, one video after the other. Program → Schedule can split
        the week later.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      <button className="button" disabled={isPending} type="submit">
        {isPending ? "Creating..." : "Create the pool and fill the week"}
      </button>
    </form>
  );
}
