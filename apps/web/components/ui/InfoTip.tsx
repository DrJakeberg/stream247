"use client";

/**
 * A small (i) beside a label that explains the field, panel or page it sits next to.
 *
 * Hover or focus reveals the text; it is also wired through aria-describedby so a screen reader
 * announces it with the control. Pure CSS for the reveal — no portal, no positioning library —
 * because the bubble is short prose, not a menu, and the admin surfaces are desktop-first with
 * enough room around a label for it to open in place.
 *
 * Not a <title> attribute: `title` tooltips do not open on keyboard focus or on touch, and they
 * cannot be styled.
 *
 * NOT A <button> EITHER, and this is the part that matters. A <button> is a labelable element. Most
 * field labels in this UI are implicit — <label><span class="label">…</span><input/></label> — and
 * a label's control is its FIRST labelable descendant. With a real button sitting inside the label
 * before the input, the label labelled the (i) and the input lost its name: every "Owner email"
 * field became an unnamed textbox, sign-in by label stopped working, and clicking the label text
 * focused the tip. A span with role="button" and tabIndex is focusable and announced as a button,
 * but it is not labelable, so the label keeps pointing at the field. Clicks on it are stopped from
 * reaching the label so the (i) never toggles a checkbox or focuses the field it explains.
 *
 * AND NO TOOLTIP ELEMENT IN THE DOM. The first cut rendered the text in a hidden <span role="tooltip">
 * beside the trigger — inside the <label>. Playwright's getByLabel, like a label's textContent,
 * reads everything under the label, hidden or not: getByLabel('Password') then matched the
 * "Owner email" field too, because its explanation mentioned the password. So the text lives in a
 * data attribute, the bubble is drawn from it with CSS ::after (generated content is not text
 * content), and assistive technology gets it through aria-description on the trigger. What still
 * reaches the label's computed name is the trigger's own short name: a field explained this way is
 * announced as "Owner email Info".
 */
export function InfoTip(props: { text: string; label?: string }) {
  const text = props.text.trim();
  if (!text) {
    return null;
  }

  return (
    <span className="info-tip">
      {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props -- aria-description is ARIA 1.3 and
          global; the rule's table stops at 1.2. Chromium and Firefox expose it. */}
      <span
        aria-description={text}
        aria-label={props.label ?? "Info"}
        className="info-tip-button"
        data-tip={text}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
          }
        }}
        role="button"
        tabIndex={0}
      >
        i
      </span>
    </span>
  );
}
