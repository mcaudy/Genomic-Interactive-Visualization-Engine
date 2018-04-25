// JavaScript Document
var GIVe = (function (give) {
  'use strict'

  give.MetaDataEntries = function (url) {
    this.url = url || give.MetaDataEntries.defaultUrl
    this.entries = {}
    this.DataPromise = give.postAjax(this.url, null, 'text', 'GET')
      .then(res => this._responseHandler(res))
      .catch(e => { throw e })
  }

  var _strArrayToMetaEntry = function (strArray) {
    var isReady = false
    var result = {} // all meta properties
    while (strArray.length > 0) {
      var line = strArray.shift().trim()
      if (line && !line.startsWith('#')) {
        // not empty line or comment
        var tokens = line.split(/\s+/)
        var key = tokens.shift().toLowerCase()
        var value = tokens.join(' ')
        result[key] = value
        if (key === 'type' && value === 'Cell Line') {
          isReady = true
          // this is because 'type Cell Line' is required per ENCODE cell line standard
        }
      } else if (!line) {
        // empty line,
        // if isReady = true, then this entry is done
        if (isReady) {
          break
        }
      }
    }
    return isReady ? result : null
  }

  give.MetaDataEntries.prototype._responseHandler = function (response) {
    if (response) {
      // file is available
      var metaTxtArray = response.split('\n') // break into lines
      while (metaTxtArray.length > 0) {
        var newEntry = _strArrayToMetaEntry(metaTxtArray)
        if (newEntry) {
          if (!this.entries[newEntry.organism.toLowerCase()]) {
            this.entries[newEntry.organism.toLowerCase()] = {}
          }
          this.entries[newEntry.organism.toLowerCase()][newEntry.term] = newEntry
        }
      }
    }
    give._verboseConsole('Meta data loaded.', give.VERBOSE_DEBUG)
    return this
  }

  give.MetaDataEntries.prototype.findMeta = function (organism, term, key) {
    if (this.entries[organism.toLowerCase()] && this.entries[organism.toLowerCase()][term]) {
      return this.entries[organism.toLowerCase()][term][key]
    }
    return null
  }

  give.MetaDataEntries.defaultUrl = give.Host +
    (give.ServerPath || '/') +
    (give.Meta_KeyTarget || 'assets/encodeDCC/cv.ra')

  give.mainMetaDataEntries = new give.MetaDataEntries()

  return give
})(GIVe || {})
