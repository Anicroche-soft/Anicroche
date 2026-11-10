import crypto        from 'node:crypto'
import { promisify } from 'node:util'

if (typeof crypto.argon2 !== 'function')
    throw new Error(`sans.js nécessite Node 24.7 ou plus récent pour argon2 (version actuelle : ${process.version})`)

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

// Paramètres et format PHC du paquet npm argon2, utilisé auparavant : les anciens hachages restent vérifiables
const deriver_brut      = promisify(crypto.argon2)
const parametres_argon2 = { memory: 65536, passes: 3, parallelism: 4, tagLength: 32 }
const format_phc        = /^\$(argon2(?:id|i|d))\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/

// Chaque calcul occupe 64 Mio : au-delà de quelques calculs simultanés, une rafale de requêtes épuiserait la mémoire
const CALCULS_SIMULTANES_MAX = 4
const CALCULS_EN_ATTENTE_MAX = 64

let calculs_en_cours = 0
const file_calculs   = []

const deriver_argon2 = async (algorithme, parametres) =>
{
    if (calculs_en_cours < CALCULS_SIMULTANES_MAX)
        calculs_en_cours++
    else if (file_calculs.length < CALCULS_EN_ATTENTE_MAX)
        await new Promise(resolve => file_calculs.push(resolve))
    else
        throw Object.assign(new Error('Trop de calculs argon2 en attente'), { code: 'ARGON2_SATURE' })

    try
    {
        return await deriver_brut(algorithme, parametres)
    }
    finally
    {
        const suivant = file_calculs.shift()
        if (suivant)
            suivant()
        else
            calculs_en_cours--
    }
}

const base64_phc = (tampon) =>
    tampon.toString('base64').replace(/=+$/, '')

export const hacher_argon2 = async (valeur) =>
{
    const { memory, passes, parallelism } = parametres_argon2
    const nonce   = crypto.randomBytes(16)
    const hachage = await deriver_argon2('argon2id', { ...parametres_argon2, message: String(valeur), nonce })
    return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${base64_phc(nonce)}$${base64_phc(hachage)}`
}

// Sans hachage valide, on calcule quand même un argon2 : la durée de réponse ne trahit pas l'absence d'un compte
let hachage_leurre = null

export const verifier_argon2 = async (hachage, valeur) =>
{
    const morceaux = String(hachage ?? '').match(format_phc)
    if (!morceaux)
    {
        hachage_leurre ??= hacher_argon2('').catch((erreur) =>
        {
            hachage_leurre = null
            throw erreur
        })
        await verifier_argon2(await hachage_leurre, valeur)
        return false
    }

    const [, algorithme, memory, passes, parallelism, nonce, attendu] = morceaux
    const empreinte = Buffer.from(attendu, 'base64')
    try
    {
        const obtenue = await deriver_argon2(algorithme, {
            message     : String(valeur),
            nonce       : Buffer.from(nonce, 'base64'),
            memory      : Number(memory),
            passes      : Number(passes),
            parallelism : Number(parallelism),
            tagLength   : empreinte.length
        })
        return crypto.timingSafeEqual(obtenue, empreinte)
    }
    catch (erreur)
    {
        if (erreur.code === 'ARGON2_SATURE')
            throw erreur
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
