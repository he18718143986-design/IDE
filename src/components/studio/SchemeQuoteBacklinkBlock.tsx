/**
 * TASK-J.32b：签字前原话回链对照面。
 * 由 SchemeReviewPane 在确认按钮前挂载；数据来自确认前只读预览接口。
 */

import type {
  SchemeBacklinkPreviewItem,
  SchemeBacklinkPreviewView,
  SchemeTrustTier,
} from "@/lib/daemon-api";

export interface SchemeQuoteBacklinkBlockProps {
  trustTier: SchemeTrustTier;
  onTrustTierChange: (tier: SchemeTrustTier) => void;
  preview: SchemeBacklinkPreviewView | null;
  busy?: boolean | undefined;
  checkedIds?: ReadonlySet<string> | undefined;
  onToggleChecked?: ((itemId: string) => void) | undefined;
}

const TIER_OPTIONS: { id: SchemeTrustTier; label: string }[] = [
  { id: "light", label: "轻确认" },
  { id: "standard", label: "标准档" },
  { id: "reconfirm", label: "重确认" },
];

function skipReasonText(reason: string): string {
  if (reason === "ai_inferred") return "这是推断出来的，不是你亲口说的";
  if (reason === "unregistered") return "引用的原话还没登记";
  return "还没有回链到已登记的原话";
}

function quoteCaption(
  item: SchemeBacklinkPreviewItem,
  quotes: { turn_id: string; user_alias_seq?: number; text: string }[],
): string | null {
  if (!item.covered) return null;
  const quote = quotes.find((q) => q.turn_id === item.turn_id);
  const seq = item.user_alias_seq ?? quote?.user_alias_seq;
  const alias = seq !== undefined ? `U${seq}` : item.turn_id;
  if (!quote) return alias;
  return `${alias}：${quote.text}`;
}

/** 重确认档：预览成功后，列表里每一项都勾过才允许确认。 */
export function reconfirmChecksComplete(
  trustTier: SchemeTrustTier,
  preview: SchemeBacklinkPreviewView | null,
  checkedIds?: ReadonlySet<string>,
): boolean {
  if (trustTier !== "reconfirm") return true;
  if (!preview || !preview.ok) return false;
  const ids = checkedIds ?? new Set<string>();
  return preview.items.every((item) => ids.has(item.id));
}

export function SchemeQuoteBacklinkBlock(props: SchemeQuoteBacklinkBlockProps) {
  const showSurface = props.trustTier !== "light";
  const showChecks = props.trustTier === "reconfirm";
  const preview = props.preview;

  return (
    <section
      data-testid="scheme-quote-backlink"
      data-trust-tier={props.trustTier}
      className="mb-3 rounded border border-border bg-card p-3"
    >
      <h3 className="text-xs font-semibold text-foreground">签字前对照</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        选择确认档位。标准档会出示「说过的每件事都有着落」；重确认还要逐项勾选；轻确认不把对照面作为默认确认步骤。
      </p>

      <fieldset className="mt-2">
        <legend className="sr-only">信任档</legend>
        <div data-testid="scheme-trust-tier" className="flex flex-wrap gap-1.5">
          {TIER_OPTIONS.map((opt) => {
            const selected = props.trustTier === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                data-testid={`scheme-trust-tier-${opt.id}`}
                data-selected={selected ? "true" : "false"}
                aria-pressed={selected}
                onClick={() => props.onTrustTierChange(opt.id)}
                className={
                  selected
                    ? "rounded border border-emerald-800 bg-emerald-700 px-2 py-1 text-[11px] text-white"
                    : "rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground hover:bg-accent"
                }
              >
                {opt.label}
                {opt.id === "standard" ? "（默认）" : ""}
              </button>
            );
          })}
        </div>
      </fieldset>

      {showSurface ? (
        <div data-testid="scheme-quote-backlink-surface" className="mt-3">
          {props.busy === true && !preview ? (
            <p
              data-testid="scheme-quote-backlink-loading"
              className="text-[11px] text-muted-foreground"
            >
              正在核对原话回链…
            </p>
          ) : null}

          {preview && !preview.ok ? (
            <p
              data-testid="scheme-quote-backlink-error"
              className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] leading-relaxed text-destructive"
            >
              {preview.message}
            </p>
          ) : null}

          {preview?.ok ? (
            <>
              <p
                data-testid="scheme-quote-backlink-counts"
                className="text-[11px] text-muted-foreground"
              >
                已覆盖 {preview.covered_count} 项，未覆盖{" "}
                {preview.uncovered_count} 项。未覆盖的会明确标出，不会被跳过。
              </p>
              <ul className="mt-2 space-y-1.5">
                {preview.items.map((item) => {
                  const checked = props.checkedIds?.has(item.id) === true;
                  const caption = quoteCaption(item, preview.quotes);
                  return (
                    <li
                      key={item.id}
                      data-testid={`scheme-quote-backlink-item-${item.id}`}
                      data-item-id={item.id}
                      data-covered={item.covered ? "true" : "false"}
                      data-source={item.source}
                      className={
                        item.covered
                          ? "rounded border border-emerald-700/30 bg-emerald-500/5 p-2 text-[11px] leading-relaxed"
                          : "rounded border border-amber-700/40 bg-amber-500/10 p-2 text-[11px] leading-relaxed"
                      }
                    >
                      <div className="flex items-start gap-2">
                        {showChecks ? (
                          <label className="mt-0.5 flex shrink-0 items-center">
                            <input
                              type="checkbox"
                              data-testid={`scheme-quote-backlink-check-${item.id}`}
                              checked={checked}
                              onChange={() => props.onToggleChecked?.(item.id)}
                            />
                            <span className="sr-only">我已核对这项</span>
                          </label>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">
                            {item.label || item.id}
                          </p>
                          {item.covered ? (
                            <p
                              data-testid={`scheme-quote-backlink-quote-${item.id}`}
                              className="mt-0.5 text-emerald-900"
                            >
                              已覆盖
                              {caption ? ` · ${caption}` : ""}
                            </p>
                          ) : (
                            <p
                              data-testid={`scheme-quote-backlink-gap-${item.id}`}
                              className="mt-0.5 text-amber-900"
                            >
                              未覆盖 · {skipReasonText(item.reason)}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
      ) : (
        <p
          data-testid="scheme-quote-backlink-light-hint"
          className="mt-2 text-[11px] text-muted-foreground"
        >
          轻确认不把对照面或逐项勾选作为默认确认步骤；冻结时仍会按已登记原话做机械回链。
        </p>
      )}
    </section>
  );
}
