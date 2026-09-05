// Measures how long viewers wait between two programme items.
//
// The interesting number at an asset boundary is not "did playout recover" — the fallback chain
// always recovers — but "how much fallback slate did viewers see before the next programme item
// started". On the DUT (v1.5.31) that was 18-19s at two of three boundaries, and nothing in the
// runtime log stated it: the duration had to be reconstructed by subtracting timestamps of two
// unrelated playout.process.start events by hand.
//
// This tracker turns that into one number per boundary, emitted as playout.boundary.gap, so a
// change in bridging behaviour is measurable on the device instead of argued about. It is
// deliberately just an observation: nothing here feeds a decision, so it cannot affect what goes
// on air.

export interface ProgrammeGap {
  /** Programme asset that left the air. */
  fromAssetId: string;
  /** Programme asset that took over. */
  toAssetId: string;
  /** Milliseconds viewers spent off programme content. */
  gapMs: number;
  /** How many fallback/bridge processes covered the boundary; 0 is a clean hand-over. */
  bridgeStarts: number;
}

interface OpenGap {
  assetId: string;
  endedAtMs: number;
  bridgeStarts: number;
}

export class ProgrammeGapTracker {
  private open: OpenGap | null = null;

  /** A programme (scheduled-tier) asset left the air. */
  openGap(assetId: string, atMs: number): void {
    this.open = { assetId, endedAtMs: atMs, bridgeStarts: 0 };
  }

  /** A fallback/bridge process went on air while a boundary is still open. */
  noteBridge(_fallbackAssetId: string): void {
    if (this.open) {
      this.open.bridgeStarts += 1;
    }
  }

  /**
   * A programme asset went on air. Returns the measured gap when a boundary was open, otherwise
   * null (start-up, or a boundary already reported). Clears the boundary either way, so one
   * boundary produces at most one measurement.
   */
  closeGap(assetId: string, atMs: number): ProgrammeGap | null {
    const open = this.open;
    this.open = null;
    if (!open) {
      return null;
    }

    return {
      fromAssetId: open.assetId,
      toAssetId: assetId,
      // A container clock stepping backwards must not produce a negative duration that would
      // poison any averaging done over these events.
      gapMs: Math.max(0, atMs - open.endedAtMs),
      bridgeStarts: open.bridgeStarts
    };
  }
}
