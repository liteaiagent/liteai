/**
 * Embedded RSA public keys for JWT verification.
 *
 * Port of liteai/keys/__init__.py
 *
 * This module embeds the public key directly so that standalone
 * executables (bun compile, pkg, etc.) work without needing the
 * PEM file on disk at runtime.
 */

export const API_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3n7Ms83nfrKlrrRB5wrH
9IC/NcoleWtDuWOfNIiiryQ7UWvpHfozT8/tiu70ewDbcGLHnVSkJfX+Bui+QBsu
iecOm42nxBIe26+l9g5zrTR6sP3hLG2LZ106nkEb06eXnjYq4mPoi0UGlq1E+vYA
4u5JnFK1lWmd+h9+rVH2OJodBsoH2D94u61y+O42nme1XW5mUZ4EKpyJVYQKugTP
tsVlrqxQWTUh29Yw7KDiFOI9N93ma8JLww0uHxSiS/9BYmUzok8OGUdHLRSgYjlR
VUozTeALI8vXIi4ixu1wPVCAQaxv1ocVzsHwr2NTOBEgeOMW3lxLdJ9TA0Vf6xeY
HwIDAQAB
-----END PUBLIC KEY-----`
