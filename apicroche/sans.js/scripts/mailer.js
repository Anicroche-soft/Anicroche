import nodemailer from 'nodemailer'

// ─── Transporteur ─────────────────────────────────────────────────────────────

let _transporteur = null

const transporteur = () =>
{
    if (_transporteur) return _transporteur

    const host = process.env.email_host
    const port = parseInt(process.env.email_port || '465')
    const user = process.env.email_user
    const pass = process.env.email_pass

    if (!host || !user || !pass)
        throw new Error("Variables d'environnement manquantes : email_host, email_user, email_pass")

    _transporteur = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
    })

    return _transporteur
}

// ─── Expéditeur ───────────────────────────────────────────────────────────────

const expediteur = () =>
{
    const name = process.env.email_name
    const user = process.env.email_user
    return name ? `"${name}" <${user}>` : user
}

// ─── Texte brut depuis HTML ───────────────────────────────────────────────────

const html_vers_texte = (html) =>
    html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

// ─── $envoyer_email ───────────────────────────────────────────────────────────

export const envoyer_email = async ({ to, subject, content, texte }) =>
{
    if (!to || !subject || !content)
        throw new Error('$send_email : to, subject et content sont requis')

    await transporteur().sendMail({
        from   : expediteur(),
        to,
        subject,
        html   : content,
        text   : texte ?? html_vers_texte(content)
    })
}

export const creer_fonctions_mailer = () => ({
    $send_email: envoyer_email
})
