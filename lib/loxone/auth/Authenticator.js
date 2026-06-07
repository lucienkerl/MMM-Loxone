"use strict";
const C = require("../crypto/LoxoneCrypto");

const PERMISSION_IDS = { web: 2, app: 4 };

function normalizeAlg(alg) {
	return alg === "SHA256" ? "SHA256" : "SHA1";
}

async function acquireToken(requester, opts) {
	const { user, password, permission, clientUuid, clientInfo } = opts;
	const keyResp = await requester.command(`jdev/sys/getkey2/${encodeURIComponent(user)}`);
	const info = keyResp.value;
	const hashAlg = normalizeAlg(info.hashAlg);
	const pwHash = C.passwordHash(password, info.salt, hashAlg);
	const hash = C.credentialHash(user, pwHash, info.key, hashAlg);
	const permId = PERMISSION_IDS[permission] || PERMISSION_IDS.app;
	const cmd = `jdev/sys/getjwt/${hash}/${encodeURIComponent(user)}/${permId}/${clientUuid}/${encodeURIComponent(clientInfo)}`;
	const resp = await requester.commandEncrypted(cmd);
	const v = resp.value;
	return {
		token: v.token,
		validUntil: v.validUntil,
		tokenRights: v.tokenRights,
		unsecurePass: v.unsecurePass,
		key: v.key,
		hashAlg
	};
}

async function authWithToken(requester, opts) {
	const { user, token, hashAlg } = opts;
	const keyResp = await requester.command("jdev/sys/getkey");
	const keyHex = typeof keyResp.value === "string" ? keyResp.value : keyResp.value.key;
	const hash = C.tokenHash(token, keyHex, normalizeAlg(hashAlg));
	const resp = await requester.command(`authwithtoken/${hash}/${encodeURIComponent(user)}`);
	return resp.code === 200;
}

module.exports = { acquireToken, authWithToken, PERMISSION_IDS };
