'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const { createHash } = require('node:crypto')

/**
 * An Asciidoctor include processor that handles remote (URL) includes. This version gets registered each time a
 * document is loaded and is thus scoped to the document, which allows it to cache the contents of the URL for
 * subsequent references. This extension relies on an internal API to look up and delegate to the default include
 * processor once the URL is cached. It caches the URL in the ROOT component, so that component must be filtered
 * out from the navigation in the UI template.
 */
function createExtensionGroup ({ contentCatalog }) {
    return function () {
        this.includeProcessor(function () {
            this.prepend() // register in front of Antora's include processor
            this.handles((target) => target.startsWith('https://') || target.startsWith('http://'))
            this.process((doc, reader, target, attrs) => {
                const cachedTarget = readUrl(contentCatalog, target)
                if (cachedTarget === false) {
                    const cursor = reader.$cursor_at_prev_line()
                    const logMessage = doc.createLogMessage(`include uri not readable: ${target}`, { source_location: cursor })
                    doc.getLogger().error(logMessage)
                    reader.pushInclude(`Unresolved directive in ${reader.path} - include::${target}[]`, target, target, 1, attrs)
                    return
                }
                const nextIncludeProcessor = findNextIncludeProcessor(doc, this, cachedTarget)
                nextIncludeProcessor && nextIncludeProcessor.process_method['$[]'](doc, reader, cachedTarget, Opal.hash(attrs))
            })
        })
    }
}

function readUrl (contentCatalog, url) {
    contentCatalog.getComponentVersion('ROOT', '') || contentCatalog.registerComponentVersion('ROOT', '')
    const src = { component: 'ROOT', version: '', module: 'cache', family: 'partial', relative: sha1(url) + '.adoc' }
    let file = contentCatalog.getById(src)
    if (!file) {
        try {
            file = contentCatalog.addFile({ contents: execFileSync('curl', ['--silent', '-L', url]), src })
        } catch {
            file = contentCatalog.addFile({ contents: null, src })
        }
    }
    return file.contents == null ? false : 'ROOT:cache:partial$' + src.relative
}

function sha1 (string) {
    const shasum = createHash('sha1')
    shasum.update(string)
    return shasum.digest('hex')
}

function findNextIncludeProcessor (doc, currentIncludeProcessor, target) {
    let skip = true
    return doc.getExtensions().$include_processors().find((candidate) => {
        candidate = candidate.instance
        if (skip) return candidate === currentIncludeProcessor ? (skip = false) : false
        return candidate.handles(target)
    })
}

module.exports.register = (registry, context) => {
    const toProc = (fn) => Object.defineProperty(fn, '$$arity', { value: fn.length })
    registry.$groups().$store('remote-include-processor', toProc(createExtensionGroup(context)))
    return registry
}
