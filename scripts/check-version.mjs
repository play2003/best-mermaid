#!/usr/bin/env node
/**
 * 发布版本一致性门禁。
 *
 * 背景：1.0.3 的 Release 里 manifest.json 写着 1.0.2——三处版本号没对齐，
 * CI 照常打包发布，用户端拿到的 manifest 与实际版本不符。发布流程无校验时
 * 这类错误只在发布后才被发现，且已产生下载。
 *
 * 用法：
 *   node scripts/check-version.mjs            # 只校验三处文件一致
 *   node scripts/check-version.mjs 1.0.4      # 额外校验与 tag/版本号一致
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));

const errors = [];

const manifest = read("manifest.json");
const pkg = read("package.json");
const versions = read("versions.json");

const manifestVersion = manifest.version;
const pkgVersion = pkg.version;

if (!/^\d+\.\d+\.\d+$/.test(manifestVersion ?? "")) {
	errors.push(`manifest.json version 不是 x.y.z 形式：${JSON.stringify(manifestVersion)}`);
}
if (manifestVersion !== pkgVersion) {
	errors.push(`版本不一致：manifest.json=${manifestVersion} package.json=${pkgVersion}`);
}
if (!Object.hasOwn(versions, manifestVersion ?? "")) {
	errors.push(`versions.json 缺少 ${manifestVersion} 条目`);
}

// tag（去掉可选的 v 前缀）必须与文件版本一致，否则发出去的包版本对不上 tag
const tag = process.argv[2]?.replace(/^v/, "");
if (tag && tag !== manifestVersion) {
	errors.push(`tag/预期版本 ${tag} 与 manifest.json version ${manifestVersion} 不一致`);
}

if (errors.length > 0) {
	console.error("发布版本校验失败：");
	for (const err of errors) console.error(`  - ${err}`);
	process.exit(1);
}

console.log(`版本校验通过：${manifestVersion}${tag ? `（tag ${tag}）` : ""}`);
