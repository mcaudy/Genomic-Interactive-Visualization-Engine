/**
 * @license
 * Copyright 2017 GIVe Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var GIVe = (function (give) {
  'use strict'

  /**
   * Non-leaf nodes for Oak Trees
   * This is an interface for all nodes that belongs to an oak tree, which is
   * an modified version of B+ tree.
   *
   * See `GIVE.GiveNonLeafNode` for common non-leaf node documentation.
   *
   * @typedef {object} OakNode
   * @property {boolean} IsRoot
   * @property {Array<number>} Keys
   * @property {Array<GiveTreeNode|null|boolean>} Values
   * @property {number} RevDepth
   * @property {OakNode|null|boolean} Next
   * @property {OakNode|null|boolean} Prev
   * @property {number} Tree.BranchingFactor - The branching factor for the B+
   *    tree.
   *    It indicates how many children at most can a node have, and how many
   *    children at least should a node have (`BranchingFactor / 2`)
   *
   * @class give.OakNode
   *
   * @constructor
   * @implements give.GiveNonLeafNode
   * @param {object} props
   * @param {GiveTree} props.Tree
   * @param {boolean} props.IsRoot
   * @param {number} props.Start
   * @param {number} props.End
   * @param {number|null} props.RevDepth
   * @param {GiveNonLeafNode|null|boolean} props.NextNode
   * @param {GiveNonLeafNode|null|boolean} props.PrevNode
   *
   */
  give.OakNode = function (props) {
    give.GiveNonLeafNode.apply(this, arguments)
  }

  give.extend(give.GiveNonLeafNode, give.OakNode)

  /**
   * _restructure - The function to be called after adding/removing data to
   *    the node.
   *    In OakNodes, auto-balancing is implemented according to B+ tree specs.
   * @memberof OakNode.prototype
   *
   * @returns {give.GiveNonLeafNode|Array<give.GiveNonLeafNode>|false}
   *    Since auto-balancing is supported, the return value will be different
   *    for root and non-root nodes:
   *    * For root nodes, this will return a new root if split/merge happens,
   *      `this` otherwise;
   *    * for inner nodes (or leaf), Return an ordered array of (one or more)
   *      siblings if splitting happens for the calling function to handle.
   *      If the node should be merged with its sibling(s), return `false`.
   *      Return `this` in all other cases.
   */
  give.OakNode.prototype._restructure = function () {
    if (this.Values.length > this.Tree.BranchingFactor) {
      // Node is over-capacity, split into sibling nodes
      // Calculate the number of siblings this node will split into
      var numOfSibs = Math.floor(this.Values.length * 2 /
        this.Tree.BranchingFactor)
      var siblings = new Array(numOfSibs - 1)

      // chop off children from the end
      for (var iSib = siblings.length - 1; iSib >= 0; iSib--) {
      // get the number of children to be put into this sibling
        var sibNumOfChildren = Math.floor(this.Values.length / (iSib + 2))
        var props = {
          IsRoot: false,
          // Extract one more key from this.Keys
          Keys: this.Keys.slice(-(sibNumOfChildren + 1)),
          Values: this.Values.slice(-sibNumOfChildren),
          RevDepth: this.RevDepth,
          NextNode: this.next,
          PrevNode: this,
          Tree: this.Tree
        }
        this.Keys.splice(-sibNumOfChildren, sibNumOfChildren)
        this.Values.splice(-sibNumOfChildren, sibNumOfChildren)

        var newSibling = new this.constructor(props)

        siblings[iSib] = newSibling
      }

      // If this is root, then a new root needs to be created
      if (this.IsRoot) {
        // add `this` to siblings
        siblings.splice(0, 0, this)
        var newRootKeys = [this.start]
        siblings.forEach(function (siblingNode) {
          newRootKeys.push(siblingNode.end)
        })
        props = {
          IsRoot: true,
          // Put `this` and all siblings under the new root
          Keys: newRootKeys,
          Values: siblings,
          RevDepth: this.RevDepth + 1,
          NextNode: null,
          PrevNode: null,
          Tree: this.Tree
        }
        var newRoot = new this.constructor(props)
        this.IsRoot = false

        return newRoot
      } else {
        return siblings
      }
    } else { // !(this.Values.length > this.Tree.BranchingFactor)
      return (!this.IsRoot && this.isEmpty) ? false : this
    }
  }

  give.OakNode.prototype._addNonLeafRecords = function (
    data, chrRange, props
  ) {
    // This function only adds record(s), it won't restructure the tree

    // This is not a leaf node
    // Break out chrRange by child, then insert the sub-range into every child
    var currIndex = 0

    while (chrRange.start < chrRange.end) {
      while (this.Keys[currIndex + 1] <= chrRange.start) {
        currIndex++
      }

      // Now the start of chrRange is in the range of current child
      var section = chrRange.clone()
      if (this.Keys[currIndex + 1] < chrRange.end) {
        section.end = this.Keys[currIndex + 1]
      }
      var sibs = this.Values[currIndex].insert(data, section, props)
      if (Array.isArray(sibs)) {
        // Has siblings, put them into this.Values
        this.Keys.splice(currIndex + 1, 0, ...sibs.map(function (sib) {
          return sib.start
        }, this))
        this.Values.splice(currIndex + 1, 0, ...sibs)
        currIndex += sibs.length
      }

      chrRange.start = section.end
      currIndex++
    } // end while(rangeStart < rangeEnd);
  }

  give.OakNode.prototype._addLeafRecords = function (
    data, chrRange, props
  ) {
    // This function only adds record(s), it won't restructure the tree

    // Find the range of child that rangeStart is in
    var currIndex = 0
    props.DataIndex = 0
    var prevDataIndex
    props.ContList = props.ContList || []
    if (!(give.GiveTreeNode.prototype.isPrototypeOf(
      props.LeafNodeCtor.prototype
    ))) {
      throw new give.GiveError('LeafNodeCtor `' + props.LeafNodeCtor +
        '` is not a constructor for a tree node!')
    }

    while (this.Keys[currIndex + 1] <= chrRange.start) {
      currIndex++
    }

    if (this.Keys[currIndex] < chrRange.start) {
      // The new rangeStart appears between windows.
      // Shorten the previous data record by inserting the key,
      // and use this.Values[currIndex] to fill the rest
      // (normally it should be `null`)
      this._splitChild(currIndex++, chrRange.start)
    }

    if (this.Keys[currIndex + 1] > chrRange.end) {
      // The new rangeEnd appears between windows.
      // Shorten the next data record by inserting the key,
      // and use this.Values[currIndex] to fill the current region
      // (normally it should be `null`)
      this._splitChild(currIndex, chrRange.end)
    }

    while (chrRange.start < chrRange.end) {
      while (this.Keys[currIndex + 1] <= chrRange.start) {
        currIndex++
      }
      if (this.Keys[currIndex] < chrRange.start) {
        // The new rangeStart appears between windows.
        // Shorten the previous data record by inserting the key,
        // and use `false` to fill the rest
        this._splitChild(currIndex++, chrRange.start, false)
      }

      if (
        props.ContList.length > 0 ||
        (props.DataIndex < data.length &&
        data[props.DataIndex].start <= this.Keys[currIndex])
      ) {
        // there are actual data at this location, create a new leaf node
        this.Values[currIndex] = new props.LeafNodeCtor({
          Start: this.Keys[currIndex],
          End: this.Keys[currIndex + 1]
        })
        this.Values[currIndex].insert(data, chrRange, props)
        if (this.Values[currIndex].isEmpty) {
          this.Values[currIndex] = false
        }
      } else {
        // needs to fill the element with `false`, and merge with previous if
        // possible
        this.Values[currIndex] = false
      }
      if (this._mergeChild(currIndex, false, true)) {
        currIndex--
      }

      // Shrink `chrRange` to unprocessed range
      chrRange.start = (
        props.DataIndex < data.length &&
        data[props.DataIndex].start < chrRange.end
      ) ? data[props.DataIndex].start : chrRange.end
    }

    this._mergeChild(currIndex, true, true)

    // Process `props.ContList` for one last time
    props.ContList = props.ContList.concat(
      data.slice(prevDataIndex, props.DataIndex)
    ).filter(function (entry) {
      return entry.end > chrRange.end
    })

    // Remove all processed data from `data`
    data.splice(0, props.DataIndex)
    delete props.DataIndex
  }

  /**
   * remove - Remove data entries from the node.
   *    Data entries with the same start (and end values if exists) will be
   *    removed. If multiple entries are found with the same start (and end
   *    values), the behavior will be defined by `removeExactMatch`.
   *
   *
   * @memberof GiveTreeNode.prototype
   *
   * @param  {ChromRegionLiteral|GiveTreeNode} data - the data entry being
   *    removed.
   * @param  {boolean} removeExactMatch - whether an exact match is needed to
   *    remove multiple data entries with the same start and end values.
   *    If `true`, `data` will be compared by `.equalTo(data)` if exists,
   *    `===` if not. (this is done via calling
   *    `this.constructor._compareData(dataIn, dataEx)`)
   *    If `false`, all entries matching the start and end values will be
   *    removed.
   * @param {boolean|null} convertTo - what shall be used to replace
   *    the removed nodes, should be either `null` (default) or `false`.
   * @param  {object|null} [props] - additional properties being
   *    passed onto nodes.
   * @param {function|null} props.Callback - the callback function to be used
   *    (with the data entry as its sole parameter) when deleting
   * @returns {give.GiveTreeNode|boolean}
   *    This shall reflect whether auto-balancing is supported for the tree.
   *    * For root nodes, return `this` if no decreasing height happen,
   *      otherwise the new root node;
   *    * For non-root nodes, return `false` if redistribution needs to be
   *      handled by its parent, return `this` if no redistribution is needed
   *      (`Keys` may still need to be readjusted)
   */
  give.OakNode.prototype.remove = function (data, removeExactMatch, props) {
    props = props || {}
    props.ConvertTo = props.ConvertTo === false ? false : null
    // Check whether `this` shall be removed
    if (this.start === data.start && this.end === data.end) {
      if (!removeExactMatch || this._compareData(data, this)) {
        // remove content of this
        if (typeof props.Callback === 'function') {
          props.Callback.call(props.ThisVar, this)
        }
        this.clear(props.ConvertTo)
        if (!this.IsRoot) {
          return false
        } else {
          return this
        }
      }
    }

    // data being remove is not self
    // locate the child entry first
    var i = 0
    while (i < this.Values.length && this.Keys[i + 1] <= data.start) {
      i++
    }
    if (this.Values[i]) {
      // data must fall within `this.Values[i]`
      if (!this.Values[i].remove(data, removeExactMatch, props)) {
        // this node will be removed if it is not literally the first node
        //    of the tree
        if (this.RevDepth <= 0) {
          this.Values[i] = props.ConvertTo
          this._fixChildLinks(i)
        } else {
          // restructure to match B+ tree specification
          var updateStart = (i === 0)
          // May need to update start because the first children is
          // involved
          // Redistribution and/or merging is needed, find its sibling
          // (default is the earlier sibling, if no earlier sibling,
          //  then the later one can be used)
          if (i === 0) {
            i++
          }

          var sibFront = this.Values[i - 1]
          var sibBack = this.Values[i]

          // does not need to merge, just redistribute
          sibFront.Keys.splice(-1, 1, sibBack.Keys)
          sibFront.Values.splice(sibBack.Values.length, sibBack.Values)

          // First check whether the total amount of children
          // in sibling and this.Values[i] is less than
          // `this.Tree.BranchingFactor`
          if (sibFront.Values.length > this.Tree.BranchingFactor) {
            var sibFrontNewNum = Math.ceil(sibFront.Values.length / 2)
            sibBack.Keys = sibFront.Keys.splice(sibFrontNewNum)
            sibBack.Values = sibFront.Values.splice(sibFrontNewNum)
            sibFront.Keys.push(sibBack.start)
          } else {
            // needs to merge, remove sibBack
            sibFront.next = sibBack.next
            sibBack.next = null
            sibBack.prev = null
            this.Values.splice(i, 1)
            this.Keys.splice(i, 1)
          }

          if (updateStart) {
            i--
          }

          // Update Keys (because child.Values[0] can be removed).
          this.Keys[i] = this.Values[i].start
          if (i === 0 && this.prev) {
            this.prev.end = this.start
          }
        }
        this._mergeChild(i, true, true)
      }
    } else {
      give._verbConsole.warn('Data ' + data + ' is not found in the tree.')
    }

    if (this.IsRoot && this.RevDepth > 0 && this.Values.length < 2) {
      // If this is root and it has only one child,
      // reduce depth of the tree by 1 and return its only child as new root
      this.Values[0].IsRoot = true
      delete this.Keys
      return this.Values[0]
    } else if (
      !this.IsRoot &&
      this.Values.length < Math.ceil(this.Tree.BranchingFactor / 2)
    ) {
      // This is not root and has less children than required.
      // Send signal upstream for parent to handle.
      return false
    }
    // This have number of children that match B+ tree requirements
    return this
  }

  give.OakNode.prototype.traverse = function (
    chrRange, callback, thisVar, filter, breakOnFalse, props
  ) {
    // Implementation without resolution support
    // Because this is a non-leaf node, it always descends to its children
    // until some leaf node is reached.

    if (chrRange) {
      var currIndex = 0
      while (currIndex < this.Values.length &&
        this.Keys[currIndex + 1] <= chrRange.start
      ) {
        currIndex++
      }
      if (this.RevDepth) {
        return (this.Keys[currIndex] < chrRange.end &&
          currIndex < this.Values.length) ? this.Values[currIndex] : null
      } else {
        while (
          this.Keys[currIndex] < chrRange.end &&
          currIndex < this.Values.length
        ) {
          if (this.Values[currIndex] &&
            (!this.Values[currIndex].traverse(chrRange, callback,
              filter, breakOnFalse, props) && breakOnFalse
            )
          ) {
            return false
          }
          props.NotFirstCall = true
          currIndex++
        }
        return (this.Keys[currIndex] < chrRange.end)
          ? this.next : null
      }
    } else { // !chrRange
      throw (new give.GiveError(chrRange + ' is not a valid chrRegion.'))
    } // end if(chrRange)
  }

  return give
})(GIVe || {})
