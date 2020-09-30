// "Virtual elements" is an abstraction on top of the usual DOM API which understands the notion that comment nodes
// may be used to represent hierarchy (in addition to the DOM's natural hierarchy).
// If you call the DOM-manipulating functions on ko.virtualElements, you will be able to read and write the state
// of that virtual hierarchy
//
// The point of all this is to support containerless templates (e.g., <!-- ko foreach:someCollection -->blah<!-- /ko -->)
// without having to scatter special cases all over the binding and templating code.
import {emptyDomNode, setDomNodeChildren as utilsSetDomNodeChildren} from './utils.domNodes';
import {removeNode} from './utils.domNodeDisposal';

export const START_COMMENT_REGEX = /^\s*ko(?:\s+([\s\S]+))?\s*$/;

const END_COMMENT_REGEX =   /^\s*\/ko\s*$/;
const SYM_MATCHED_END_COMMENT = Symbol('__ko_matchedEndComment__');
const HTML_TAGS_WITH_OPTIONAL_CLOSING_CHILDREN = {ul: true, ol: true};

export const allowedBindings = {};
export const allowedVirtualElementBindings = allowedBindings;

const _isStartComment = (node) => (node.nodeType === 8) && START_COMMENT_REGEX.test(node.nodeValue); //@inline
const _isEndComment = (node) => (node.nodeType === 8) && END_COMMENT_REGEX.test(node.nodeValue); //@inline

export const hasBindingValue = _isStartComment;

const _getVirtualChildren = (startComment, allowUnbalanced) => {
        let currentNode = startComment.nextSibling,
            depth = 1,
            childIndex = -1,
            children = [];
        
        while (currentNode) {
            if (_isEndComment(currentNode)) {
                currentNode[SYM_MATCHED_END_COMMENT] = true;
                if (!--depth) {
                    return children;
                }
            }
            children[++childIndex] = currentNode;
            if (_isStartComment(currentNode)) {
                depth++;
            }
            currentNode = currentNode.nextSibling;
        }
        if (!allowUnbalanced) {
            throw new Error('Cannot find closing comment tag to match: ' + startComment.nodeValue);
        }
        return null;
    };

const _getMatchingEndComment = (startComment, allowUnbalanced) => {
    let allVirtualChildren = _getVirtualChildren(startComment, allowUnbalanced);
    if (allVirtualChildren) {
        let totalVirtualChildren = allVirtualChildren.length;
        return (totalVirtualChildren ? allVirtualChildren[totalVirtualChildren - 1] : startComment).nextSibling;
    }
    return null; // Must have no matching end comment, and allowUnbalanced is true
};

const _getUnbalancedChildTags = (node) => {
    // e.g., from <div>OK</div><!-- ko blah --><span>Another</span>, returns: <!-- ko blah --><span>Another</span>
    //       from <div>OK</div><!-- /ko --><!-- /ko -->,             returns: <!-- /ko --><!-- /ko -->
    let childNode = node.firstChild, 
        captureRemaining = null;
    
    while (childNode) {
        if (captureRemaining) {
            // We already hit an unbalanced node and are now just scooping up all subsequent nodes
            captureRemaining.push(childNode);
        } else if (_isStartComment(childNode)) {
            let matchingEndComment = _getMatchingEndComment(childNode, /* allowUnbalanced: */ true);
            if (matchingEndComment) {
                childNode = matchingEndComment; // It's a balanced tag, so skip immediately to the end of this virtual set
            } else {
                captureRemaining = [childNode]; // It's unbalanced, so start capturing from this point
            }
        } else if (_isEndComment(childNode)) {
            captureRemaining = [childNode];     // It's unbalanced (if it wasn't, we'd have skipped over it already), so start capturing
        }
        
        childNode = childNode.nextSibling;
    }
    return captureRemaining;
};

export const childNodes = (node) => _isStartComment(node) ? _getVirtualChildren(node) : node.childNodes;

export const emptyNode = (node) => {
    if (!_isStartComment(node)) {
        emptyDomNode(node);
        return;
    }
    let virtualChildren = childNodes(node);
    for (let i = 0, j = virtualChildren.length; i < j; i++) {
        removeNode(virtualChildren[i]);
    }
};

export const setDomNodeChildren = (node, childNodes) => {
    if (!_isStartComment(node)) {
        utilsSetDomNodeChildren(node, childNodes);
        return;
    }
    emptyNode(node);
    let endCommentNode = node.nextSibling; // Must be the next sibling, as we just emptied the children
    for (let i = 0, j = childNodes.length; i < j; i++) {
        endCommentNode.parentNode.insertBefore(childNodes[i], endCommentNode);
    }
};

export const prepend = (containerNode, nodeToPrepend) => {
    let insertBeforeNode;

    if (_isStartComment(containerNode)) {
        // Start comments must always have a parent and at least one following sibling (the end comment)
        insertBeforeNode = containerNode.nextSibling;
        containerNode = containerNode.parentNode;
    } else {
        insertBeforeNode = containerNode.firstChild;
    }

    if (!insertBeforeNode) {
        containerNode.appendChild(nodeToPrepend);
    } else if (nodeToPrepend !== insertBeforeNode) {       // IE will sometimes crash if you try to insert a node before itself
        containerNode.insertBefore(nodeToPrepend, insertBeforeNode);
    }
};

export const insertAfter = (containerNode, nodeToInsert, insertAfterNode) => {
    if (!insertAfterNode) {
        prepend(containerNode, nodeToInsert);
        return;
    }
    // Children of start comments must always have a parent and at least one following sibling (the end comment)
    let insertBeforeNode = insertAfterNode.nextSibling;

    if (_isStartComment(containerNode)) {
        containerNode = containerNode.parentNode;
    }

    if (!insertBeforeNode) {
        containerNode.appendChild(nodeToInsert);
    } else if (nodeToInsert !== insertBeforeNode) {       // IE will sometimes crash if you try to insert a node before itself
        containerNode.insertBefore(nodeToInsert, insertBeforeNode);
    }
};

export const firstChild = (node) => {
    if (!_isStartComment(node)) {
        let _nodeFirstChild = node.firstChild; 
        if (_nodeFirstChild && _isEndComment(_nodeFirstChild)) {
            throw new Error('Found invalid end comment, as the first child of ' + node);
        }
        return _nodeFirstChild;
    } 
    let _nodeNextSibling = node.nextSibling;
    if (!_nodeNextSibling|| _isEndComment(_nodeNextSibling)) {
        return null;
    }
    return _nodeNextSibling;
};

export const nextSibling = (node) => {
    if (_isStartComment(node)) {
        node = _getMatchingEndComment(node);
    }
    let _nodeNextSibling = node.nextSibling;
    if (_nodeNextSibling && _isEndComment(_nodeNextSibling)) {
        if (!_nodeNextSibling[SYM_MATCHED_END_COMMENT]) {
            // unmatched end comment!
            throw Error('Found end comment without a matching opening comment, as child of ' + node);
        } 
        return null;
    }
    return _nodeNextSibling;
};

