// Mini-DOM pour le rendu côté serveur : juste ce dont le moteur d'avec.js et les scripts
// des modèles ont besoin pour construire une page, puis la sérialiser en HTML.
// Les mesures (tailles, défilement) valent toujours 0 et les événements ne sont jamais émis.

const ESPACE_HTML = `http://www.w3.org/1999/xhtml`
const ESPACE_SVG  = `http://www.w3.org/2000/svg`

const ELEMENT  = 1
const TEXTE    = 3
const COMMENT  = 8
const DOCUMENT = 9
const FRAGMENT = 11

const BALISES_VIDES = new Set([
    `area`, `base`, `br`,    `col`,  `embed`,  `hr`,  `img`,
    `input`, `link`, `meta`, `source`, `track`, `wbr`
])

const BALISES_TEXTE_BRUT = new Set([`style`, `script`])

const echapper_texte = (texte) => texte
    .replaceAll(`&`, `&amp;`)
    .replaceAll(`<`, `&lt;`)
    .replaceAll(`>`, `&gt;`)

const echapper_attribut = (texte) => texte
    .replaceAll(`&`, `&amp;`)
    .replaceAll(`"`, `&quot;`)

const en_kebab = (nom) => nom.startsWith(`--`)
    ? nom
    : nom.replace(/[A-Z]/g, (lettre) => `-${lettre.toLowerCase()}`)

const en_camel = (nom) => nom.replace(/-([a-z])/g, (_, lettre) => lettre.toUpperCase())

// ─── Événements ──────────────────────────────────────────────────────────────

class Cible
{
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true }
}

// ─── Nœuds ───────────────────────────────────────────────────────────────────

class Noeud extends Cible
{
    constructor(type, document)
    {
        super()
        this.nodeType      = type
        this.ownerDocument = document
        this.parentNode    = null
        this.childNodes    = []
    }

    get parentElement()
    {
        return this.parentNode?.nodeType === ELEMENT ? this.parentNode : null
    }

    get firstChild() { return this.childNodes[0] ?? null }
    get lastChild()  { return this.childNodes.at(-1) ?? null }

    get nextSibling()
    {
        if (!this.parentNode)
            return null
        const freres = this.parentNode.childNodes
        return freres[freres.indexOf(this) + 1] ?? null
    }

    get previousSibling()
    {
        if (!this.parentNode)
            return null
        const freres = this.parentNode.childNodes
        const index  = freres.indexOf(this)
        return index > 0 ? freres[index - 1] : null
    }

    get isConnected()
    {
        let noeud = this
        while (noeud.parentNode)
            noeud = noeud.parentNode
        return noeud.nodeType === DOCUMENT
    }

    get textContent()
    {
        return this.childNodes.map((enfant) => enfant.textContent).join(``)
    }

    set textContent(valeur)
    {
        this.replaceChildren()
        const texte = String(valeur ?? ``)
        if (texte !== ``)
            this.appendChild(this.ownerDocument.createTextNode(texte))
    }

    getRootNode()
    {
        let noeud = this
        while (noeud.parentNode)
            noeud = noeud.parentNode
        return noeud
    }

    contains(autre)
    {
        let noeud = autre
        while (noeud)
        {
            if (noeud === this)
                return true
            noeud = noeud.parentNode
        }
        return false
    }

    // Un fragment se vide dans son nouveau parent ; une chaîne devient un nœud texte
    preparer_insertion(noeuds)
    {
        const resultat = []
        for (const noeud of noeuds)
        {
            if (noeud === null || noeud === undefined)
                continue
            if (typeof noeud !== `object`)
                resultat.push(this.ownerDocument.createTextNode(String(noeud)))
            else if (noeud.nodeType === FRAGMENT)
                resultat.push(...noeud.childNodes)
            else
                resultat.push(noeud)
        }
        for (const noeud of resultat)
            noeud.parentNode?.retirer_enfant(noeud)
        return resultat
    }

    retirer_enfant(enfant)
    {
        const index = this.childNodes.indexOf(enfant)
        if (index !== -1)
            this.childNodes.splice(index, 1)
        enfant.parentNode = null
    }

    inserer_a(index, noeuds)
    {
        for (const noeud of noeuds)
            noeud.parentNode = this
        this.childNodes.splice(index, 0, ...noeuds)
    }

    appendChild(enfant)
    {
        this.append(enfant)
        return enfant
    }

    append(...noeuds)
    {
        const a_inserer = this.preparer_insertion(noeuds)
        this.inserer_a(this.childNodes.length, a_inserer)
    }

    prepend(...noeuds)
    {
        const a_inserer = this.preparer_insertion(noeuds)
        this.inserer_a(0, a_inserer)
    }

    insertBefore(enfant, reference)
    {
        if (!reference)
            return this.appendChild(enfant)
        const a_inserer = this.preparer_insertion([enfant])
        this.inserer_a(this.childNodes.indexOf(reference), a_inserer)
        return enfant
    }

    removeChild(enfant)
    {
        this.retirer_enfant(enfant)
        return enfant
    }

    replaceChildren(...noeuds)
    {
        for (const enfant of this.childNodes)
            enfant.parentNode = null
        this.childNodes = []
        this.append(...noeuds)
    }

    before(...noeuds)
    {
        const parent = this.parentNode
        if (!parent)
            return
        const a_inserer = parent.preparer_insertion(noeuds.filter((noeud) => noeud !== this))
        parent.inserer_a(parent.childNodes.indexOf(this), a_inserer)
    }

    after(...noeuds)
    {
        const parent = this.parentNode
        if (!parent)
            return
        const a_inserer = parent.preparer_insertion(noeuds.filter((noeud) => noeud !== this))
        parent.inserer_a(parent.childNodes.indexOf(this) + 1, a_inserer)
    }

    replaceWith(...noeuds)
    {
        const parent = this.parentNode
        if (!parent)
            return
        this.after(...noeuds)
        parent.retirer_enfant(this)
    }

    remove()
    {
        this.parentNode?.retirer_enfant(this)
    }
}

class Texte extends Noeud
{
    constructor(donnees, document)
    {
        super(TEXTE, document)
        this.data = String(donnees)
    }

    get nodeName()    { return `#text` }
    get nodeValue()   { return this.data }
    set nodeValue(v)  { this.data = String(v ?? ``) }
    get textContent() { return this.data }
    set textContent(v){ this.data = String(v ?? ``) }

    cloneNode() { return this.ownerDocument.createTextNode(this.data) }
}

class Commentaire extends Noeud
{
    constructor(donnees, document)
    {
        super(COMMENT, document)
        this.data = String(donnees)
    }

    get nodeName()    { return `#comment` }
    get nodeValue()   { return this.data }
    set nodeValue(v)  { this.data = String(v ?? ``) }
    get textContent() { return this.data }
    set textContent(v){ this.data = String(v ?? ``) }

    cloneNode() { return this.ownerDocument.createComment(this.data) }
}

class Fragment extends Noeud
{
    constructor(document)
    {
        super(FRAGMENT, document)
    }

    get nodeName() { return `#document-fragment` }
    get children() { return this.childNodes.filter((n) => n.nodeType === ELEMENT) }

    querySelector(selecteur)    { return chercher(this, selecteur, true)[0] ?? null }
    querySelectorAll(selecteur) { return chercher(this, selecteur, false) }
}

// ─── Classes, dataset et style ───────────────────────────────────────────────

class ListeClasses
{
    constructor(element)
    {
        this.element = element
    }

    get liste()
    {
        return (this.element.getAttribute(`class`) ?? ``).split(/\s+/).filter(Boolean)
    }

    ecrire(liste)
    {
        this.element.setAttribute(`class`, liste.join(` `))
    }

    get length() { return this.liste.length }

    item(index) { return this.liste[index] ?? null }

    contains(classe) { return this.liste.includes(classe) }

    add(...classes)
    {
        const liste = this.liste
        for (const classe of classes)
            if (!liste.includes(classe))
                liste.push(classe)
        this.ecrire(liste)
    }

    remove(...classes)
    {
        if (!this.element.hasAttribute(`class`))
            return
        this.ecrire(this.liste.filter((classe) => !classes.includes(classe)))
    }

    toggle(classe, forcer)
    {
        const presente = this.contains(classe)
        const voulue   = forcer === undefined ? !presente : !!forcer
        if (voulue && !presente)
            this.add(classe)
        if (!voulue && presente)
            this.remove(classe)
        return voulue
    }

    replace(ancienne, nouvelle)
    {
        if (!this.contains(ancienne))
            return false
        this.ecrire(this.liste.map((classe) => classe === ancienne ? nouvelle : classe))
        return true
    }

    toString() { return this.liste.join(` `) }

    [Symbol.iterator]() { return this.liste[Symbol.iterator]() }
}

const creer_dataset = (element) => new Proxy({}, {
    get: (_, clef) => typeof clef === `string`
        ? element.getAttribute(`data-${en_kebab(clef)}`) ?? undefined
        : undefined,
    set: (_, clef, valeur) =>
    {
        element.setAttribute(`data-${en_kebab(clef)}`, String(valeur))
        return true
    },
    deleteProperty: (_, clef) =>
    {
        element.removeAttribute(`data-${en_kebab(clef)}`)
        return true
    },
    has: (_, clef) => element.hasAttribute(`data-${en_kebab(clef)}`),
    ownKeys: () => element.noms_attributs()
        .filter((nom) => nom.startsWith(`data-`))
        .map((nom) => en_camel(nom.slice(5))),
    getOwnPropertyDescriptor: (_, clef) => element.hasAttribute(`data-${en_kebab(clef)}`)
        ? {enumerable: true, configurable: true, value: element.getAttribute(`data-${en_kebab(clef)}`)}
        : undefined
})

const lire_declarations = (texte) =>
{
    const declarations = new Map()
    for (const morceau of (texte ?? ``).split(`;`))
    {
        const position = morceau.indexOf(`:`)
        if (position <= 0)
            continue
        const nom    = morceau.slice(0, position).trim()
        const valeur = morceau.slice(position + 1).trim()
        if (nom)
            declarations.set(nom, valeur)
    }
    return declarations
}

const creer_style = (element) =>
{
    const lire   = () => lire_declarations(element.getAttribute(`style`))
    const ecrire = (declarations) =>
    {
        if (declarations.size === 0)
        {
            element.removeAttribute(`style`)
            return
        }
        element.setAttribute(`style`, [...declarations]
            .map(([nom, valeur]) => `${nom}: ${valeur};`)
            .join(` `))
    }

    const methodes = {
        setProperty: (nom, valeur) =>
        {
            const declarations = lire()
            if (valeur === null || valeur === undefined || valeur === ``)
                declarations.delete(nom)
            else
                declarations.set(nom, String(valeur))
            ecrire(declarations)
        },
        removeProperty: (nom) =>
        {
            const declarations = lire()
            const ancienne     = declarations.get(nom) ?? ``
            declarations.delete(nom)
            ecrire(declarations)
            return ancienne
        },
        getPropertyValue: (nom) => lire().get(nom) ?? ``
    }

    return new Proxy({}, {
        get: (_, clef) =>
        {
            if (typeof clef !== `string`)
                return undefined
            if (clef in methodes)
                return methodes[clef]
            if (clef === `cssText`)
                return element.getAttribute(`style`) ?? ``
            return lire().get(en_kebab(clef)) ?? ``
        },
        set: (_, clef, valeur) =>
        {
            if (clef === `cssText`)
                ecrire(lire_declarations(String(valeur)))
            else
                methodes.setProperty(en_kebab(clef), valeur)
            return true
        }
    })
}

// ─── Éléments ────────────────────────────────────────────────────────────────

class Element extends Noeud
{
    constructor(etiquette, espace, document)
    {
        super(ELEMENT, document)
        this.namespaceURI = espace
        this.localName    = espace === ESPACE_HTML ? etiquette.toLowerCase() : etiquette
        this.attributs    = new Map()
        this.classList    = new ListeClasses(this)
        this.dataset      = creer_dataset(this)
        this.style        = creer_style(this)
    }

    get tagName()  { return this.namespaceURI === ESPACE_HTML ? this.localName.toUpperCase() : this.localName }
    get nodeName() { return this.tagName }

    get children()               { return this.childNodes.filter((n) => n.nodeType === ELEMENT) }
    get childElementCount()      { return this.children.length }
    get firstElementChild()      { return this.children[0] ?? null }
    get lastElementChild()       { return this.children.at(-1) ?? null }

    get nextElementSibling()
    {
        let noeud = this.nextSibling
        while (noeud && noeud.nodeType !== ELEMENT)
            noeud = noeud.nextSibling
        return noeud
    }

    get previousElementSibling()
    {
        let noeud = this.previousSibling
        while (noeud && noeud.nodeType !== ELEMENT)
            noeud = noeud.previousSibling
        return noeud
    }

    // Attributs

    noms_attributs() { return [...this.attributs.keys()] }

    get attributes()
    {
        return [...this.attributs].map(([name, value]) => ({name, value}))
    }

    getAttribute(nom)       { return this.attributs.has(nom) ? this.attributs.get(nom) : null }
    hasAttribute(nom)       { return this.attributs.has(nom) }
    setAttribute(nom, val)  { this.attributs.set(String(nom), String(val)) }
    removeAttribute(nom)    { this.attributs.delete(nom) }
    hasAttributes()         { return this.attributs.size > 0 }

    toggleAttribute(nom, forcer)
    {
        const voulu = forcer === undefined ? !this.hasAttribute(nom) : !!forcer
        if (voulu)
        {
            if (!this.hasAttribute(nom))
                this.setAttribute(nom, ``)
        }
        else
        {
            this.removeAttribute(nom)
        }
        return voulu
    }

    get id()           { return this.getAttribute(`id`) ?? `` }
    set id(valeur)     { valeur === `` ? this.removeAttribute(`id`) : this.setAttribute(`id`, valeur) }
    get className()    { return this.getAttribute(`class`) ?? `` }
    set className(val) { val === `` ? this.removeAttribute(`class`) : this.setAttribute(`class`, val) }

    // Propriétés reflétées par des attributs (utiles à la lecture par les scripts)
    get value()        { return this.getAttribute(`value`) ?? (this.localName === `textarea` ? this.textContent : ``) }
    set value(valeur)
    {
        if (this.localName === `textarea`)
            this.textContent = valeur
        else
            this.setAttribute(`value`, valeur)
    }
    get checked()      { return this.hasAttribute(`checked`) }
    set checked(v)     { this.toggleAttribute(`checked`, v) }
    get disabled()     { return this.hasAttribute(`disabled`) }
    set disabled(v)    { this.toggleAttribute(`disabled`, v) }
    get type()         { return this.getAttribute(`type`) ?? (this.localName === `input` ? `text` : ``) }
    set type(valeur)   { this.setAttribute(`type`, valeur) }
    get name()         { return this.getAttribute(`name`) ?? `` }
    get href()         { return this.getAttribute(`href`) ?? `` }
    get hidden()       { return this.hasAttribute(`hidden`) }
    set hidden(v)      { this.toggleAttribute(`hidden`, v) }

    // Mesures et interactions : sans objet côté serveur
    get offsetWidth()  { return 0 }
    get offsetHeight() { return 0 }
    get clientWidth()  { return 0 }
    get clientHeight() { return 0 }
    get scrollWidth()  { return 0 }
    get scrollHeight() { return 0 }
    get scrollTop()    { return 0 }
    set scrollTop(_)   {}
    get scrollLeft()   { return 0 }
    set scrollLeft(_)  {}

    getBoundingClientRect()
    {
        return {x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0}
    }

    getClientRects()  { return [] }
    scrollIntoView()  {}
    scrollTo()        {}
    scrollBy()        {}
    focus()           {}
    blur()            {}
    click()           {}
    animate()         { return {finished: Promise.resolve(), cancel() {}} }
    getAnimations()   { return [] }

    // Recherche

    matches(selecteur)          { return correspond(this, analyser_selecteur(selecteur), this) }
    querySelector(selecteur)    { return chercher(this, selecteur, true)[0] ?? null }
    querySelectorAll(selecteur) { return chercher(this, selecteur, false) }

    closest(selecteur)
    {
        const liste = analyser_selecteur(selecteur)
        let noeud   = this
        while (noeud && noeud.nodeType === ELEMENT)
        {
            if (correspond(noeud, liste, noeud))
                return noeud
            noeud = noeud.parentNode
        }
        return null
    }

    getElementsByTagName(etiquette) { return chercher(this, etiquette, false) }
    getElementsByClassName(classe)  { return chercher(this, `.${classe}`, false) }

    cloneNode(profond = false)
    {
        const copie = this.ownerDocument.createElementNS(this.namespaceURI, this.localName)
        for (const [nom, valeur] of this.attributs)
            copie.setAttribute(nom, valeur)
        if (profond)
            copie.append(...this.childNodes.map((enfant) => enfant.cloneNode(true)))
        return copie
    }

    get innerHTML()  { return this.childNodes.map((enfant) => serialiser(enfant)).join(``) }
    get outerHTML()  { return serialiser(this) }
}

// ─── Document ────────────────────────────────────────────────────────────────

class Document extends Noeud
{
    constructor()
    {
        super(DOCUMENT, null)
        this.ownerDocument = null
        this.documentElement = this.createElement(`html`)
        this.head = this.createElement(`head`)
        this.body = this.createElement(`body`)
        this.documentElement.append(this.head, this.body)
        this.appendChild(this.documentElement)
        this.activeElement = this.body
        this.readyState = `complete`
    }

    get nodeName() { return `#document` }
    get children() { return [this.documentElement] }

    createElement(etiquette)
    {
        return new Element(String(etiquette), ESPACE_HTML, this)
    }

    createElementNS(espace, etiquette)
    {
        return new Element(String(etiquette), espace ?? ESPACE_HTML, this)
    }

    createTextNode(texte)          { return new Texte(texte, this) }
    createComment(texte)           { return new Commentaire(texte, this) }
    createDocumentFragment()       { return new Fragment(this) }

    getElementById(id)             { return chercher(this, `#${id}`, true)[0] ?? null }
    querySelector(selecteur)       { return chercher(this, selecteur, true)[0] ?? null }
    querySelectorAll(selecteur)    { return chercher(this, selecteur, false) }
    getElementsByTagName(etiquette){ return chercher(this, etiquette, false) }
    getElementsByClassName(classe) { return chercher(this, `.${classe}`, false) }

    hasFocus() { return false }
}

export const creer_document = () => new Document()

// ─── Sélecteurs ──────────────────────────────────────────────────────────────
// Pris en charge : étiquette, *, #id, .classe, [attr], [attr=valeur] (et ^= $= *= ~=),
// :scope, :not(…), :disabled, :checked, :first-child, :last-child,
// combinateurs descendant, >, + et ~, listes séparées par des virgules

const cache_selecteurs = new Map()

const lire_simple = (texte, position) =>
{
    const simple = {etiquette: null, id: null, classes: [], attributs: [], pseudos: []}
    let i = position

    const lire_identifiant = () =>
    {
        const debut = i
        while (i < texte.length && /[\w-]/.test(texte[i]))
            i++
        return texte.slice(debut, i)
    }

    if (texte[i] === `*`)
    {
        i++
    }
    else if (/[\w-]/.test(texte[i] ?? ``))
    {
        simple.etiquette = lire_identifiant()
    }

    while (i < texte.length)
    {
        const caractere = texte[i]
        if (caractere === `#`)
        {
            i++
            simple.id = lire_identifiant()
        }
        else if (caractere === `.`)
        {
            i++
            simple.classes.push(lire_identifiant())
        }
        else if (caractere === `[`)
        {
            const fin = texte.indexOf(`]`, i)
            const interieur = texte.slice(i + 1, fin).trim()
            i = fin + 1
            const correspondance = interieur.match(/^([\w-]+)\s*(?:([\^$*~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*)))?$/)
            if (!correspondance)
                throw new Error(`Sélecteur d'attribut non pris en charge : [${interieur}]`)
            simple.attributs.push({
                nom: correspondance[1],
                operateur: correspondance[2] ?? null,
                valeur: correspondance[3] ?? correspondance[4] ?? correspondance[5] ?? null
            })
        }
        else if (caractere === `:`)
        {
            i++
            const nom = lire_identifiant()
            if (texte[i] === `(`)
            {
                let profondeur = 1
                const debut = i + 1
                i++
                while (i < texte.length && profondeur > 0)
                {
                    if (texte[i] === `(`) profondeur++
                    if (texte[i] === `)`) profondeur--
                    i++
                }
                simple.pseudos.push({nom, argument: analyser_selecteur(texte.slice(debut, i - 1))})
            }
            else
            {
                simple.pseudos.push({nom, argument: null})
            }
        }
        else
        {
            break
        }
    }
    return {simple, position: i}
}

// Un sélecteur complexe est stocké de droite à gauche : [{simple, combinateur}…],
// où `combinateur` relie chaque partie à la suivante (vers la gauche)
const analyser_complexe = (texte) =>
{
    const parties = []
    let i = 0
    let combinateur = null
    while (i < texte.length)
    {
        while (texte[i] === ` `)
            i++
        if (i >= texte.length)
            break
        if (`>+~`.includes(texte[i]))
        {
            combinateur = texte[i]
            i++
            continue
        }
        if (parties.length > 0 && combinateur === null)
            combinateur = ` `
        const lu = lire_simple(texte, i)
        if (lu.position === i)
            throw new Error(`Sélecteur non pris en charge : ${texte}`)
        parties.push({simple: lu.simple, combinateur})
        combinateur = null
        i = lu.position
    }
    // Chaque partie garde le combinateur qui la relie à la précédente ; on inverse pour remonter
    return parties.reverse()
}

const decouper_virgules = (texte) =>
{
    const morceaux = []
    let profondeur = 0
    let guillemet  = null
    let debut      = 0
    for (let i = 0; i < texte.length; i++)
    {
        const caractere = texte[i]
        if (guillemet)
        {
            if (caractere === guillemet)
                guillemet = null
            continue
        }
        if (caractere === `"` || caractere === `'`)
            guillemet = caractere
        else if (caractere === `(` || caractere === `[`)
            profondeur++
        else if (caractere === `)` || caractere === `]`)
            profondeur--
        else if (caractere === `,` && profondeur === 0)
        {
            morceaux.push(texte.slice(debut, i))
            debut = i + 1
        }
    }
    morceaux.push(texte.slice(debut))
    return morceaux.map((morceau) => morceau.trim().replace(/\s+/g, ` `)).filter(Boolean)
}

const analyser_selecteur = (texte) =>
{
    const clef = String(texte)
    if (!cache_selecteurs.has(clef))
        cache_selecteurs.set(clef, decouper_virgules(clef).map(analyser_complexe))
    return cache_selecteurs.get(clef)
}

const correspond_attribut = (element, {nom, operateur, valeur}) =>
{
    if (!element.hasAttribute(nom))
        return false
    if (operateur === null)
        return true
    const actuelle = element.getAttribute(nom)
    switch (operateur)
    {
    case `=`:  return actuelle === valeur
    case `^=`: return valeur !== `` && actuelle.startsWith(valeur)
    case `$=`: return valeur !== `` && actuelle.endsWith(valeur)
    case `*=`: return valeur !== `` && actuelle.includes(valeur)
    case `~=`: return actuelle.split(/\s+/).includes(valeur)
    case `|=`: return actuelle === valeur || actuelle.startsWith(`${valeur}-`)
    default:   return false
    }
}

const correspond_simple = (element, simple, portee) =>
{
    if (simple.etiquette && element.localName.toLowerCase() !== simple.etiquette.toLowerCase())
        return false
    if (simple.id !== null && element.id !== simple.id)
        return false
    for (const classe of simple.classes)
        if (!element.classList.contains(classe))
            return false
    for (const attribut of simple.attributs)
        if (!correspond_attribut(element, attribut))
            return false
    for (const {nom, argument} of simple.pseudos)
    {
        switch (nom)
        {
        case `scope`:
            if (element !== portee)
                return false
            break
        case `not`:
            if (correspond(element, argument, portee))
                return false
            break
        case `is`:
        case `where`:
            if (!correspond(element, argument, portee))
                return false
            break
        case `disabled`:
            if (!element.hasAttribute(`disabled`))
                return false
            break
        case `enabled`:
            if (element.hasAttribute(`disabled`))
                return false
            break
        case `checked`:
            if (!element.hasAttribute(`checked`) && !element.hasAttribute(`selected`))
                return false
            break
        case `first-child`:
            if (element.previousElementSibling)
                return false
            break
        case `last-child`:
            if (element.nextElementSibling)
                return false
            break
        default:
            throw new Error(`Pseudo-classe non prise en charge : :${nom}`)
        }
    }
    return true
}

const correspond_complexe = (element, parties, index, portee) =>
{
    const {simple, combinateur} = parties[index]
    if (!correspond_simple(element, simple, portee))
        return false
    if (index === parties.length - 1)
        return true

    // `combinateur` relie cette partie à celle de gauche (parties[index + 1])
    switch (combinateur)
    {
    case `>`:
    {
        const parent = element.parentElement
        return !!parent && correspond_complexe(parent, parties, index + 1, portee)
    }
    case ` `:
    {
        let ancetre = element.parentElement
        while (ancetre)
        {
            if (correspond_complexe(ancetre, parties, index + 1, portee))
                return true
            ancetre = ancetre.parentElement
        }
        return false
    }
    case `+`:
    {
        const frere = element.previousElementSibling
        return !!frere && correspond_complexe(frere, parties, index + 1, portee)
    }
    case `~`:
    {
        let frere = element.previousElementSibling
        while (frere)
        {
            if (correspond_complexe(frere, parties, index + 1, portee))
                return true
            frere = frere.previousElementSibling
        }
        return false
    }
    default:
        return false
    }
}

const correspond = (element, liste, portee) =>
    liste.some((parties) => correspond_complexe(element, parties, 0, portee))

const chercher = (racine, selecteur, premier) =>
{
    const liste    = analyser_selecteur(selecteur)
    const portee   = racine.nodeType === ELEMENT ? racine : null
    const resultat = []
    const parcourir = (noeud) =>
    {
        for (const enfant of noeud.childNodes)
        {
            if (enfant.nodeType !== ELEMENT)
                continue
            if (correspond(enfant, liste, portee))
            {
                resultat.push(enfant)
                if (premier)
                    return true
            }
            if (parcourir(enfant))
                return true
        }
        return false
    }
    parcourir(racine)
    return resultat
}

// ─── Sérialisation ───────────────────────────────────────────────────────────

// `commentaires` : conserver les commentaires (les ancres du moteur sont inutiles dans le HTML)
export const serialiser = (noeud, {commentaires = true} = {}) =>
{
    switch (noeud.nodeType)
    {
    case TEXTE:
        return noeud.parentNode?.nodeType === ELEMENT && BALISES_TEXTE_BRUT.has(noeud.parentNode.localName)
            ? noeud.data
            : echapper_texte(noeud.data)
    case COMMENT:
        return commentaires ? `<!--${noeud.data}-->` : ``
    case DOCUMENT:
    case FRAGMENT:
        return noeud.childNodes.map((enfant) => serialiser(enfant, {commentaires})).join(``)
    case ELEMENT:
    {
        const etiquette = noeud.localName
        // Un attribut `class` vidé (classe d'animation retirée…) n'est pas écrit
        const attributs = [...noeud.attributs]
            .filter(([nom, valeur]) => !(nom === `class` && valeur.trim() === ``))
            .map(([nom, valeur]) => valeur === `` ? ` ${nom}` : ` ${nom}="${echapper_attribut(valeur)}"`)
            .join(``)
        if (noeud.namespaceURI === ESPACE_HTML && BALISES_VIDES.has(etiquette))
            return `<${etiquette}${attributs}>`
        const contenu = noeud.childNodes.map((enfant) => serialiser(enfant, {commentaires})).join(``)
        return `<${etiquette}${attributs}>${contenu}</${etiquette}>`
    }
    default:
        return ``
    }
}

export const serialiser_enfants = (noeud, options) =>
    noeud.childNodes.map((enfant) => serialiser(enfant, options)).join(``)
