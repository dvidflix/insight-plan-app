import DOMPurify from 'dompurify';

/** Formatted notes (markers…): the small set of tags the note editor makes, nothing else, so a note
    pasted in or read from a saved configuration cannot carry a script. Links open in a new tab. */
const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'ul', 'ol', 'li', 'br', 'p', 'div', 'span', 'a', 'font', 'h4'];
const ALLOWED_ATTR = ['href', 'style', 'color', 'target', 'rel'];

let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

export function sanitizeNote(html: string): string {
  hook();
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i });
}

/** True when the note has no text (an empty editor leaves "<br>" or "<div><br></div>" behind). */
export const isEmptyNote = (html: string | undefined): boolean => !html || !(new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').trim();
