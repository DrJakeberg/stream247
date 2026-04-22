import Link from "next/link";
import type { AssetRecord } from "@/lib/server/state";
import { buildAssetDisplayTitle, isReplayTitlePrefix, parseAssetHashtagsJson } from "@/lib/asset-metadata";
import { AssetMetadataForm } from "@/components/asset-metadata-form";
import { Panel } from "@/components/panel";

export function AssetMetadataDrawer(props: {
  asset: AssetRecord;
  categoryOptions: string[];
  closeHref: string;
}) {
  const hashtags = parseAssetHashtagsJson(props.asset.hashtagsJson);
  const replayEnabled = isReplayTitlePrefix(props.asset.titlePrefix);

  return (
    <aside className="program-metadata-drawer">
      <Panel eyebrow="Program" title="Video metadata">
        <div className="stack-form">
          <div className="item">
            <strong>{buildAssetDisplayTitle(props.asset, props.asset.title)}</strong>
            <div className="subtle">
              {props.asset.sourceId} · {props.asset.status}
            </div>
          </div>
          <div className="program-metadata-badges">
            <span className={`programming-status-pill ${replayEnabled ? "programming-status-overflow" : "programming-status-balanced"}`}>
              {replayEnabled ? "Replay enabled" : "Replay off"}
            </span>
            <span className="programming-status-pill programming-status-balanced">
              {props.asset.categoryName || "No category"}
            </span>
            {hashtags.length > 0 ? (
              hashtags.map((tag) => (
                <span className="programming-status-pill programming-status-balanced" key={tag}>
                  #{tag}
                </span>
              ))
            ) : (
              <span className="subtle">No hashtags configured</span>
            )}
          </div>
          <AssetMetadataForm asset={props.asset} categoryOptions={props.categoryOptions} />
          <div className="stats-row">
            <Link className="button secondary" href={props.closeHref}>
              Close
            </Link>
            <Link className="button button-ghost" href={`/assets/${encodeURIComponent(props.asset.id)}`}>
              Open full detail
            </Link>
          </div>
        </div>
      </Panel>
    </aside>
  );
}
