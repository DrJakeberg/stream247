import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The worker hands every viewer text the channel language (M80 follow-up, named by the M80 gate).
 *
 * Why a guard and not more pins: the language is an optional parameter everywhere — payloads cached
 * before M80 do not carry it and the admin's check-in API leaves it out on purpose — so a call that
 * drops it still compiles and every wording test still passes, because those call the helpers
 * directly. The only thing that changes is the air: English on a German channel. Before this file
 * five call sites were pinned by source text and no test imports apps/worker/src/index.ts (it
 * starts the worker), so the other sites could lose the argument unseen.
 *
 * So the worker sources are parsed, and for every function that writes a text a viewer reads the
 * call must pass the channel language, and what it passes must be traceable to the setting:
 * viewerLanguage(), resolveChannelLanguage(<managed config>), the bridge's viewerLocale, the scene
 * payload's locale, or a parameter of a function that is itself in the list (so its callers are
 * held to the same rule). A literal, undefined or nothing at all fails. A source-text guard, and it
 * knows it: a new helper that writes viewer text has to be added to LOCALE_SLOT by hand.
 */

const WORKER_SRC = new URL("../../apps/worker/src/", import.meta.url);
/** The files the M80 gate named; the guard reads every worker source, these must be among them. */
const NAMED_FILES = ["index.ts", "chat-control.ts", "chat-game.ts", "twitch-engagement.ts", "twitch-metadata.ts"];
const workerFiles = readdirSync(WORKER_SRC)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
  .sort();
const read = (name: string) => readFileSync(new URL(name, WORKER_SRC), "utf8");

/** Where a function takes the language: the nth argument, or the `locale` field of the nth. */
type LocaleSlot = { at: number; field?: true };
const arg = (at: number): LocaleSlot => ({ at });
const field: LocaleSlot = { at: 0, field: true };

// A Map, not an object: callee names are looked up as written, and "toString" is one of them.
const LOCALE_SLOT = new Map<string, LocaleSlot>(
  Object.entries({
    // The catalogue and its formatters (packages/core/src/viewer-messages).
    viewerText: arg(0),
    localizeViewerBuiltInText: arg(0),
    formatViewerNumber: arg(0),
    formatViewerClock: arg(0),
    formatViewerTimeZoneName: arg(0),
    viewerUpperCase: arg(0),
    viewerIntlTag: arg(0),
    // The picture: the payload carries the language to the renderer and to the text slate.
    buildOverlayScenePayload: field,
    buildOverlayTextLines: field,
    buildLiveBridgeOverlayText: field,
    overlayNextTimeLabel: arg(1),
    buildOverlayBrandLine: arg(2),
    resolveOverlayHeadlineForQueueKind: arg(3),
    formatOverlayClock: arg(2),
    // The chat bot's replies.
    formatChatSkipPausedReply: arg(1),
    formatChatGameInfoReply: field,
    formatChatGameNoRoomReply: field,
    formatPresenceClampReply: field,
    chatGameViewerName: arg(1),
    // The worker's own: the poll, skip and game panels the playout container re-derives from rows,
    // the name of a nameless chatter, and the Twitch title fallback.
    buildEngagementOverlayViewFromVoteSession: arg(2),
    buildEngagementOverlayViewFromSkipVote: arg(2),
    getOverlayView: arg(1),
    buildChatGameOverlayViewFromRuntimeRecord: arg(1),
    renderModel: arg(2),
    parseTwitchIrcMessage: arg(1),
    resolveTwitchFallbackTitle: field,
    // The standby and reconnect slate's fields (M102): the slate's title and next line.
    buildStandbySlateSceneInput: field,
    // The bot's answers (M104): !commands, !now, !next, a request's reply, and the titles they name.
    formatChatCommandsReply: field,
    formatChatNowReply: arg(2),
    formatChatNextReply: arg(2),
    formatChatRequestReply: field,
    buildChatProgrammeInfo: field,
    // M105 (R22, R23, R27): the answers taken out of index.ts into chat-answers.ts, and the read when asked.
    answerChatEffect: field,
    replyToChatRequest: field,
    readChatProgrammeInfoNow: field
  })
);

/** Objects whose `.locale` is the channel language: the scene payload buildOverlayScenePayload built. */
const SCENE_PAYLOADS = new Set(["currentScenePayload", "payload"]);

function calleeName(call: ts.CallExpression): string {
  const callee = call.expression;
  return ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
}

function unwrap(expression: ts.Expression): ts.Expression {
  let inner = expression;
  while (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isNonNullExpression(inner)) {
    inner = inner.expression;
  }
  return inner;
}

type Declared = { kind: "parameter"; owner: ts.SignatureDeclaration; index: number } | { kind: "const"; value: ts.Expression };

/** What a name stands for where it is used: a parameter of an enclosing function, or a const with a value. */
function declarationOf(identifier: ts.Identifier): Declared | null {
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      const index = scope.parameters.findIndex((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === identifier.text);
      if (index > -1) {
        return { kind: "parameter", owner: scope, index };
      }
    }
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) {
      continue;
    }
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) {
        continue;
      }
      const found = statement.declarationList.declarations.find(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === identifier.text
      );
      if (found) {
        // A `let` could be reassigned to anything after the line that is read here.
        const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
        return isConst && found.initializer ? { kind: "const", value: found.initializer } : null;
      }
    }
  }
  return null;
}

function ownerName(owner: ts.SignatureDeclaration): string {
  return owner.name && ts.isIdentifier(owner.name) ? owner.name.text : "";
}

/** A parameter is the channel language when its function is in the list and this is its language slot. */
function isLanguageParameter(declared: Declared | null, asField: boolean): boolean {
  if (declared?.kind !== "parameter") {
    return false;
  }
  const slot = LOCALE_SLOT.get(ownerName(declared.owner));
  return slot !== undefined && slot.at === declared.index && Boolean(slot.field) === asField;
}

/** Whether an expression is the channel language, traced back to the setting. */
function isChannelLanguage(expression: ts.Expression, depth = 0): boolean {
  const value = unwrap(expression);
  if (ts.isCallExpression(value)) {
    const callee = calleeName(value);
    if (callee === "viewerLanguage") {
      return value.arguments.length === 0;
    }
    // Without the managed config it would be the env alone, and Admin -> Settings would do nothing.
    return callee === "resolveChannelLanguage" && value.arguments.length > 0 && /managedConfig/i.test(value.arguments[0]!.getText());
  }
  if (ts.isPropertyAccessExpression(value)) {
    const owner = unwrap(value.expression);
    if (value.name.text === "viewerLocale") {
      return owner.kind === ts.SyntaxKind.ThisKeyword;
    }
    if (value.name.text !== "locale") {
      return false;
    }
    if (SCENE_PAYLOADS.has(ts.isIdentifier(owner) ? owner.text : ts.isPropertyAccessExpression(owner) ? owner.name.text : "")) {
      return true;
    }
    // args.locale: the arguments object of a function in the list, whose callers fill the field.
    return ts.isIdentifier(owner) && isLanguageParameter(declarationOf(owner), true);
  }
  if (!ts.isIdentifier(value) || depth > 3) {
    return false;
  }
  const declared = declarationOf(value);
  return declared?.kind === "const" ? isChannelLanguage(declared.value, depth + 1) : isLanguageParameter(declared, false);
}

/** The expression a call passes as the language, or null when it passes none the guard can see. */
function localeArgument(call: ts.CallExpression, slot: LocaleSlot): ts.Expression | null {
  const passed = call.arguments.slice(0, slot.at + 1);
  const argument = passed[slot.at];
  if (!argument || passed.some((entry) => ts.isSpreadElement(entry))) {
    return null;
  }
  if (!slot.field) {
    return argument;
  }
  if (!ts.isObjectLiteralExpression(argument)) {
    return null;
  }
  for (const property of argument.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === "locale") {
      return property.initializer;
    }
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === "locale") {
      return property.name;
    }
  }
  return null;
}

function returnsOf(owner: ts.SignatureDeclaration): ts.ReturnStatement[] {
  const found: ts.ReturnStatement[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isReturnStatement(node)) {
      found.push(node);
    }
    // A return inside a nested callback answers the callback, not this function.
    ts.forEachChild(node, (child) => (ts.isFunctionLike(child) ? undefined : visit(child)));
  };
  if ("body" in owner && owner.body) {
    visit(owner.body as ts.Node);
  }
  return found;
}

/** One call that passes the language, and the edit that would take the language away from it. */
type Site = { at: string; what: string; from: number; to: number; instead: string };
type Audit = { offenders: string[]; seen: string[]; sites: Site[] };

function parse(name: string, source: string) {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const line = (node: ts.Node) => `${name}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
  return { file, line };
}

/**
 * How the language is dropped at a call: the trailing argument cut off (what a careless edit does,
 * and what compiles), `undefined` where other arguments follow, the field gone from an object.
 */
function removal(call: ts.CallExpression, slot: LocaleSlot, value: ts.Expression): Pick<Site, "from" | "to" | "instead"> {
  if (slot.field) {
    return { from: value.parent.getStart(), to: value.parent.getEnd(), instead: "...{}" };
  }
  return slot.at > 0 && call.arguments.length === slot.at + 1
    ? { from: call.arguments[slot.at - 1]!.getEnd(), to: value.getEnd(), instead: "" }
    : { from: value.getStart(), to: value.getEnd(), instead: "undefined" };
}

/** Every viewer-text call in one source that does not pass the channel language. */
function languageAudit(name: string, source: string): Audit {
  const { file, line } = parse(name, source);
  const audit: Audit = { offenders: [], seen: [], sites: [] };
  const check = (node: ts.Node, what: string, value: ts.Expression | null | undefined) => {
    audit.seen.push(what);
    if (!value) {
      audit.offenders.push(`${line(node)}: ${what} is given no language`);
    } else if (!isChannelLanguage(value)) {
      audit.offenders.push(`${line(node)}: ${what} is given ${value.getText()}, which is not the channel language`);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const what = calleeName(node);
      const slot = LOCALE_SLOT.get(what);
      if (slot) {
        const value = localeArgument(node, slot);
        check(node, what, value);
        if (value) {
          audit.sites.push({ at: line(node), what, ...removal(node, slot, value) });
        }
      }
    }
    // The two places the language is read from the setting for texts written between cycles.
    if (ts.isFunctionDeclaration(node) && node.name?.text === "viewerLanguage") {
      const returns = returnsOf(node);
      check(node, "viewerLanguage()", returns.length === 1 ? returns[0]!.expression : null);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText() === "this.viewerLocale") {
      check(node, "this.viewerLocale =", node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return audit;
}

/** The helpers a chat line may come from. Each is in LOCALE_SLOT, so each is given the language. */
const REPLY_BUILDERS = new Set([
  "viewerText",
  "formatChatSkipPausedReply",
  "formatChatGameInfoReply",
  "formatChatGameNoRoomReply",
  "formatPresenceClampReply",
  // The answers to !commands, !now, !next and !request (M104).
  "formatChatCommandsReply",
  "formatChatNowReply",
  "formatChatNextReply",
  "formatChatRequestReply"
]);
/** The bridge's two ways to speak: say() for the worker, sendChatMessage() behind it and inside the bridge. */
const CHAT_SENDERS = new Set(["say", "sendChatMessage"]);

/** Whether a line said in chat was written by the catalogue, and not typed where it is sent. */
function isCatalogueReply(expression: ts.Expression, depth = 0): boolean {
  const value = unwrap(expression);
  if (ts.isCallExpression(value)) {
    return REPLY_BUILDERS.has(calleeName(value));
  }
  if (!ts.isIdentifier(value) || depth > 3) {
    return false;
  }
  const declared = declarationOf(value);
  if (declared?.kind === "const") {
    return isCatalogueReply(declared.value, depth + 1);
  }
  if (declared?.kind !== "parameter") {
    return false;
  }
  // say(message) hands its argument to the socket write; its callers are checked as senders.
  if (CHAT_SENDERS.has(ownerName(declared.owner))) {
    return true;
  }
  // The game command's answer is whatever handleChatGameCommand returned, which is checked below.
  const then = declared.owner.parent;
  return (
    ts.isCallExpression(then) &&
    ts.isPropertyAccessExpression(then.expression) &&
    then.expression.name.text === "then" &&
    then.expression.expression.getText().includes("this.onChatGameCommand(")
  );
}

/** Every line the bot says that the catalogue did not write. */
function chatReplyAudit(name: string, source: string): Audit {
  const { file, line } = parse(name, source);
  const audit: Audit = { offenders: [], seen: [], sites: [] };
  const check = (node: ts.Node, what: string, value: ts.Expression | undefined, silenceAllowed: boolean) => {
    audit.seen.push(what);
    const silence = silenceAllowed && value !== undefined && ts.isStringLiteral(value) && value.text === "";
    if (!silence && !(value && isCatalogueReply(value))) {
      audit.offenders.push(`${line(node)}: ${what} says ${value ? value.getText() : "nothing"}, which the catalogue did not write`);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && CHAT_SENDERS.has(calleeName(node))) {
      check(node, calleeName(node), node.arguments[0], false);
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === "handleChatGameCommand") {
      // "" is its documented silence: the cooldown answers nothing.
      for (const statement of returnsOf(node)) {
        check(statement, "handleChatGameCommand", statement.expression, true);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return audit;
}

/** The nth match of `from` replaced; everything else is left as written. */
function swap(source: string, from: string | RegExp, to: string, occurrence = 1): string {
  const pattern = typeof from === "string" ? new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : new RegExp(from.source, "g");
  let count = 0;
  const swapped = source.replace(pattern, (match) => (++count === occurrence ? to : match));
  expect(swapped, `nothing to replace: ${String(from)} (#${occurrence})`).not.toBe(source);
  return swapped;
}

describe("the worker gives every viewer text the channel language", () => {
  const audits = new Map(workerFiles.map((name) => [name, languageAudit(name, read(name))]));

  // What the guard has to find today, so it cannot pass by finding nothing: the texts each file
  // writes, by the helper that writes them. Not a count — a new text needs no edit here.
  const WRITTEN_TODAY: Record<string, string[]> = {
    "index.ts": [
      "viewerLanguage()",
      "viewerText",
      "formatChatSkipPausedReply",
      "formatChatGameInfoReply",
      "formatChatGameNoRoomReply",
      "buildOverlayScenePayload",
      "buildLiveBridgeOverlayText",
      "overlayNextTimeLabel",
      "buildEngagementOverlayViewFromVoteSession",
      "buildEngagementOverlayViewFromSkipVote",
      "buildChatGameOverlayViewFromRuntimeRecord",
      "resolveTwitchFallbackTitle"
    ],
    "chat-control.ts": ["viewerText", "buildEngagementOverlayViewFromVoteSession", "buildEngagementOverlayViewFromSkipVote"],
    "chat-game.ts": ["renderModel"],
    "twitch-engagement.ts": ["this.viewerLocale =", "viewerText", "parseTwitchIrcMessage", "formatPresenceClampReply"],
    "twitch-metadata.ts": ["localizeViewerBuiltInText"],
    "scene-renderer.ts": ["formatOverlayClock"],
    // Since M105 the IRC handler's answers and the request replies are written here (index.ts passes the
    // language to answerChatEffect and replyToChatRequest, which the list holds to the same rule).
    "chat-answers.ts": [
      "formatChatSkipPausedReply",
      "formatChatCommandsReply",
      "formatChatNowReply",
      "formatChatNextReply",
      "formatChatRequestReply"
    ],
    "chat-programme-info.ts": ["buildChatProgrammeInfo", "localizeViewerBuiltInText"]
  };

  it("reads the files the gate named and finds the viewer text each one writes", () => {
    expect(workerFiles).toEqual(expect.arrayContaining(NAMED_FILES));
    expect(Object.keys(WRITTEN_TODAY)).toEqual(expect.arrayContaining(NAMED_FILES));
    const notFound = Object.entries(WRITTEN_TODAY).flatMap(([name, calls]) =>
      calls.filter((call) => !audits.get(name)?.seen.includes(call)).map((call) => `${name}: ${call}`)
    );
    expect(notFound).toEqual([]);
  });

  it("leaves it out nowhere, and passes nothing else in its place", () => {
    expect([...audits.values()].flatMap((audit) => audit.offenders)).toEqual([]);
  });

  it(
    "would notice the language taken away at any single one of those calls",
    () => {
      // Each call that passes a language is edited on its own, the way removal() describes, and the
      // guard has to name that call. This is what the wording tests cannot do: they stay green.
      const unnoticed: string[] = [];
      const edited: string[] = [];
      for (const name of workerFiles) {
        const source = read(name);
        for (const site of audits.get(name)!.sites) {
          const without = source.slice(0, site.from) + site.instead + source.slice(site.to);
          const noticed = languageAudit(name, without).offenders.some((offender) => offender.startsWith(`${site.at}: ${site.what} `));
          (noticed ? edited : unnoticed).push(`${site.at}: ${site.what}`);
        }
      }
      expect(unnoticed).toEqual([]);
      for (const name of NAMED_FILES) {
        expect(edited.some((site) => site.startsWith(`${name}:`)), `no call edited in ${name}`).toBe(true);
      }
    },
    // The worker's entry file is parsed once per call it makes.
    120_000
  );

  it.each<[string, string, (source: string) => string]>([
    [
      "the poll asking in German on every channel, as it did before M80",
      "chat-control.ts",
      (source) => swap(source, 'viewerText(locale, "vote.headline")', 'viewerText("de", "vote.headline")')
    ],
    [
      "a reply with English written in",
      "index.ts",
      (source) => swap(source, 'viewerText(viewerLanguage(), "chat.game.stopped")', 'viewerText("en", "chat.game.stopped")')
    ],
    [
      "the standby slate fixed to English",
      "index.ts",
      (source) => swap(source, "const locale = resolveChannelLanguage(state.managedConfig);", 'const locale = "en";', 1)
    ],
    [
      "the on-air overlay's language made reassignable",
      "index.ts",
      (source) => swap(source, "const locale = resolveChannelLanguage(state.managedConfig);", "let locale = resolveChannelLanguage(state.managedConfig);", 2)
    ],
    [
      "the playout's poll and skip panels cut off from the picture's language",
      "index.ts",
      (source) => swap(source, "const locale = currentScenePayload.locale;", "const locale = undefined;")
    ],
    [
      "the language between cycles read from nowhere",
      "index.ts",
      (source) => swap(source, "return resolveChannelLanguage(latestManagedConfig ?? undefined);", 'return "en";')
    ],
    [
      "the admin's setting left out of it, so only the env would count",
      "index.ts",
      (source) => swap(source, "resolveChannelLanguage(latestManagedConfig ?? undefined)", "resolveChannelLanguage(undefined)")
    ],
    [
      "the chat bridge keeping the English it starts with",
      "twitch-engagement.ts",
      (source) => swap(source, "this.viewerLocale = resolveChannelLanguage(state.managedConfig, env);", 'this.viewerLocale = "en";')
    ],
    [
      "the Twitch title fallback in English",
      "twitch-metadata.ts",
      (source) => swap(source, "localizeViewerBuiltInText(args.locale, args.playoutTitle)", 'localizeViewerBuiltInText("en", args.playoutTitle)')
    ],
    [
      "a language handed on by a function whose callers nobody checks",
      "chat-control.ts",
      (source) => swap(source, "export function buildEngagementOverlayViewFromSkipVote(", "export function buildSkipPanel(")
    ]
  ])("would notice %s", (_what, name, mutate) => {
    // More than the file has as written, so a real offender cannot stand in for the edit's.
    const asWritten = audits.get(name)!.offenders.length;
    expect(languageAudit(name, mutate(read(name))).offenders.length).toBeGreaterThan(asWritten);
  });
});

describe("the chat bot says only what the catalogue wrote", () => {
  const audits = new Map(workerFiles.map((name) => [name, chatReplyAudit(name, read(name))]));
  const worker = read("index.ts");
  const bridge = read("twitch-engagement.ts");
  const flat = (text: string) => text.replace(/\s+/g, " ");

  it("finds the bot's lines: the worker's two skip refusals, the bridge's own sends, the game command's answers", () => {
    // The refusal of a vote that passed is said in index.ts; the IRC handler's refusal, !commands, !now,
    // !next and the request replies in chat-answers.ts since M105 (R27), to which index.ts hands the
    // bridge's own say and nothing that wraps it.
    expect(audits.get("index.ts")!.seen.filter((what) => what === "say").length).toBeGreaterThanOrEqual(1);
    expect(audits.get("chat-answers.ts")!.seen.filter((what) => what === "say").length).toBeGreaterThanOrEqual(6);
    expect(worker.match(/say: twitchChatBridge\.say\.bind\(twitchChatBridge\)/g)).toHaveLength(3);
    expect(worker).not.toMatch(/say: \([^)]*\) =>/);
    // Five answers and the cooldown's silence.
    expect(audits.get("index.ts")!.seen.filter((what) => what === "handleChatGameCommand").length).toBeGreaterThanOrEqual(6);
    // The check-in's confirmation and its failure, the game command's answer, and say() passing its line on.
    expect(audits.get("twitch-engagement.ts")!.seen.filter((what) => what === "sendChatMessage").length).toBeGreaterThanOrEqual(4);
    // The game command's answers reach the room through the bridge's callback and nothing else.
    expect(worker).toContain("onChatGameCommand: (args) => handleChatGameCommand(args),");
  });

  it("types no line where it is sent", () => {
    expect([...audits.values()].flatMap((audit) => audit.offenders)).toEqual([]);
  });

  it("has one socket write for chat lines, so no line can go around the senders", () => {
    const writes = workerFiles.flatMap((name) => read(name).match(/PRIVMSG #\$\{/g) ?? []);
    expect(writes).toHaveLength(1);
    expect(flat(bridge)).toContain('private sendChatMessage(message: string, priority: ChatLinePriority = "normal"): void {');
    expect(flat(bridge)).toContain("this.socket.write(`PRIVMSG #${this.channel} :${message}\\r\\n`); }");
  });

  it.each<[string, string, (source: string) => string]>([
    [
      "a game reply typed in English again",
      "index.ts",
      (source) => swap(source, 'return viewerText(viewerLanguage(), "chat.game.stopped");', 'return "Game stopped.";')
    ],
    [
      "a skip refusal typed where it is said",
      "index.ts",
      (source) => swap(source, "twitchChatBridge.say(formatChatSkipPausedReply(heldBy, viewerLanguage()));", "twitchChatBridge.say(`Skip votes are paused (${heldBy}).`);")
    ],
    [
      "the check-in failure typed in the bridge",
      "twitch-engagement.ts",
      (source) =>
        swap(
          source,
          'this.sendChatMessage(viewerText(this.viewerLocale, "chat.presence.saveFailed", { actor: presenceWindow.actor }));',
          "this.sendChatMessage(`@${presenceWindow.actor} please try again`);"
        )
    ],
    [
      "the check-in confirmation built by hand",
      "twitch-engagement.ts",
      (source) => swap(source, "const reply = formatPresenceClampReply({", "const reply = describeWindow({")
    ]
  ])("would notice %s", (_what, name, mutate) => {
    const asWritten = audits.get(name)!.offenders.length;
    expect(chatReplyAudit(name, mutate(read(name))).offenders.length).toBeGreaterThan(asWritten);
  });
});

describe("the language the bot speaks is the setting's, refreshed where the bot lives", () => {
  const worker = read("index.ts");
  const bridge = read("twitch-engagement.ts");

  it("refreshes the managed config in the chat cycle before the bridge is synced", () => {
    // viewerLanguage() reads latestManagedConfig. The playout and uplink cycles refresh it too, but
    // those are other processes: the bot's replies depend on this line in the worker's own cycle.
    const refresh = worker.indexOf("latestManagedConfig = chatCycleState.managedConfig;");
    expect(refresh).toBeGreaterThan(-1);
    expect(refresh).toBeLessThan(worker.indexOf("await twitchChatBridge.sync(chatCycleState, process.env, {"));
  });

  it("reads the bridge's language on every sync, also one that ends disconnected", () => {
    const sync = bridge.slice(bridge.indexOf("async sync("), bridge.indexOf("say(message: string): void {"));
    const read = sync.indexOf("this.viewerLocale = resolveChannelLanguage(state.managedConfig, env);");
    expect(read).toBeGreaterThan(-1);
    // Ahead of the first return: a sync that leaves early must not keep the language of the last one.
    expect(read).toBeLessThan(sync.indexOf("return;"));
  });
});
