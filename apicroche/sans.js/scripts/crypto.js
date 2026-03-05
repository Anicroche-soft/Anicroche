import crypto from 'node:crypto'
import argon2 from 'argon2'

// ─── Clefs ────────────────────────────────────────────────────────────────────

const clef_hmac = () =>
{
    const clef = process.env.secret_hmac
    if (!clef)
        throw new Error("Variable d'environnement manquante : secret_hmac")
    return clef
}

const clef_aes = () =>
{
    const clef = process.env.secret_aes
    if (!clef)
        throw new Error("Variable d'environnement manquante : secret_aes")
    const buf = Buffer.from(clef, 'hex')
    if (buf.length !== 32)
        throw new Error("secret_aes doit être une chaîne hexadécimale de 64 caractères (256 bits)")
    return buf
}

// ─── HMAC-SHA256 (déterministe) ───────────────────────────────────────────────

export const hacher_hmac = (valeur) =>
    crypto
        .createHmac('sha256', clef_hmac())
        .update(String(valeur))
        .digest('hex')

// ─── Argon2id (non déterministe) ─────────────────────────────────────────────

export const hacher_argon2 = (valeur) =>
    argon2.hash(String(valeur), { type: argon2.argon2id })

export const verifier_argon2 = async (hachage, valeur) =>
{
    try
    {
        return await argon2.verify(hachage, String(valeur))
    }
    catch
    {
        return false
    }
}

// ─── AES-256-GCM ─────────────────────────────────────────────────────────────
// Format stocké : iv (12 octets) + etiquette auth (16 octets) + chiffré (variable)

export const chiffrer_aes = (valeur) =>
{
    const clef      = clef_aes()
    const iv        = crypto.randomBytes(12)
    const cipher    = crypto.createCipheriv('aes-256-gcm', clef, iv)
    const chiffre   = Buffer.concat([cipher.update(String(valeur), 'utf8'), cipher.final()])
    const etiquette = cipher.getAuthTag()
    return Buffer.concat([iv, etiquette, chiffre])
}

export const dechiffrer_aes = (tampon) =>
{
    const clef        = clef_aes()
    const iv          = tampon.subarray(0, 12)
    const etiquette   = tampon.subarray(12, 28)
    const chiffre     = tampon.subarray(28)
    const decipher    = crypto.createDecipheriv('aes-256-gcm', clef, iv)
    decipher.setAuthTag(etiquette)
    return Buffer.concat([decipher.update(chiffre), decipher.final()]).toString('utf8')
}
