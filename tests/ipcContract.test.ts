import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 前后端 IPC 契约检查。
 *
 * 命令名或参数名写错，只会在运行时点到那个按钮才暴露。这里直接对比
 * Rust 侧 `generate_handler!` 注册的命令、`#[tauri::command]` 的实际签名，
 * 与 TS 侧 `invoke("...")` 的调用，静态地把这类错误挡住。
 */

const ROOT = join(__dirname, "..");
const TAURI_SRC = join(ROOT, "src-tauri/src");

function readAllRust(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return [readAllRust(p)];
      if (e.name.endsWith(".rs")) return [readFileSync(p, "utf8")];
      return [];
    })
    .join("\n");
}

const rustSource = readAllRust(TAURI_SRC);
const libSource = readFileSync(join(TAURI_SRC, "lib.rs"), "utf8");

/** generate_handler! 里注册的命令 */
function registeredCommands(): string[] {
  const block = libSource.match(
    /invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/,
  );
  expect(block, "没找到 generate_handler! 块").toBeTruthy();
  return Array.from(block![1].matchAll(/commands::(\w+)/g)).map((m) => m[1]);
}

/**
 * 按顶层逗号切分参数列表。
 * 不能直接 split(",")——`State<'_, AppState>` 这类泛型里也有逗号。
 */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "<" || ch === "(" || ch === "[") depth++;
    else if (ch === ">" || ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) parts.push(current);
  return parts;
}

/** 带 #[tauri::command] 属性的函数名，以及它是否声明了 rename_all = camelCase */
function definedCommands(): Map<string, { camel: boolean; args: string[] }> {
  const out = new Map<string, { camel: boolean; args: string[] }>();
  const re =
    /#\[tauri::command(?:\(([^)]*)\))?\]\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:->|\{)/g;
  for (const m of rustSource.matchAll(re)) {
    const attr = m[1] ?? "";
    const name = m[2];
    const argBlock = m[3];
    const args = splitTopLevel(argBlock)
      .map((a) => a.trim())
      .filter((a) => a.length > 0)
      // 去掉参数上的属性宏，如 #[allow(non_snake_case)] foo: T
      .map((a) => a.replace(/#\[[^\]]*\]\s*/g, "").trim())
      .map((a) => a.split(":")[0].trim())
      .filter(
        (a) =>
          /^\w+$/.test(a) &&
          // 这些是 Tauri 注入项，不是前端要传的参数
          !["state", "app", "app_handle", "service", "window"].includes(a),
      );
    out.set(name, { camel: attr.includes("camelCase"), args });
  }
  return out;
}

/** TS 侧所有 invoke 调用及其传入的参数键 */
function invokedCommands(): {
  command: string;
  keys: string[];
  file: string;
}[] {
  const dir = join(ROOT, "src/lib/api");
  const results: { command: string; keys: string[]; file: string }[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(join(dir, file), "utf8");
    // invoke("cmd", { a, b: x }) —— 参数对象可能跨行
    for (const m of text.matchAll(
      /invoke(?:<[^>]*>)?\(\s*"(\w+)"\s*(?:,\s*\{([\s\S]*?)\}\s*)?\)/g,
    )) {
      const keys = (m[2] ?? "")
        .split(",")
        .map((k) => k.split(":")[0].trim())
        .filter((k) => k.length > 0 && /^\w+$/.test(k));
      results.push({ command: m[1], keys, file });
    }
  }
  return results;
}

const registered = registeredCommands();
const defined = definedCommands();
const invoked = invokedCommands();

/** snake_case -> camelCase */
function toCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

describe("前后端 IPC 契约", () => {
  it("能解析出命令清单（防止正则失效导致空跑通过）", () => {
    expect(registered.length).toBeGreaterThan(20);
    expect(defined.size).toBeGreaterThan(20);
    expect(invoked.length).toBeGreaterThan(20);
  });

  it("注册的命令都有对应的 #[tauri::command] 定义", () => {
    const missing = registered.filter((c) => !defined.has(c));
    expect(missing, `generate_handler! 里注册了但没定义: ${missing}`).toEqual(
      [],
    );
  });

  it("前端调用的每个命令都已在后端注册", () => {
    const set = new Set(registered);
    const missing = invoked
      .filter((i) => !set.has(i.command))
      .map((i) => `${i.file}: ${i.command}`);
    expect(missing, `前端调用了未注册的命令: ${missing}`).toEqual([]);
  });

  it("每个已定义的命令都被注册（避免写完忘了挂上去）", () => {
    const set = new Set(registered);
    const orphan = Array.from(defined.keys()).filter((c) => !set.has(c));
    expect(orphan, `定义了但没注册: ${orphan}`).toEqual([]);
  });

  it("前端传的参数名与后端签名匹配（含 camelCase 重命名）", () => {
    const problems: string[] = [];
    for (const call of invoked) {
      const def = defined.get(call.command);
      if (!def) continue;
      const expected = new Set(
        def.args.map((a) => (def.camel ? toCamel(a) : a)),
      );
      for (const key of call.keys) {
        if (!expected.has(key)) {
          problems.push(
            `${call.command}: 前端传了 "${key}"，后端签名只接受 [${Array.from(expected).join(", ")}]`,
          );
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("后端的必填参数前端都传了", () => {
    const problems: string[] = [];
    for (const call of invoked) {
      const def = defined.get(call.command);
      if (!def) continue;
      const provided = new Set(call.keys);
      for (const arg of def.args) {
        const name = def.camel ? toCamel(arg) : arg;
        if (!provided.has(name)) {
          problems.push(`${call.command}: 后端需要 "${name}"，前端没传`);
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
