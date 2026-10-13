"""Remove the review-only design toggle before shipping.

The toggle is a temporary tool for comparing old vs new design on the real
page. It must not reach production. Run this, then delete this script and
assets/js/design-toggle.js.

    python remove-design-toggle.py            # show what would change
    python remove-design-toggle.py --apply    # do it
"""
import os, re, sys

apply_ = '--apply' in sys.argv
SKIP = {'backups', 'uploads', 'reports', '.git', 'node_modules'}
TAG = re.compile(rb'(\r?\n)?<script src="[^"]*assets/js/design-toggle\.js"></script>')

hits = []
for dp, dn, fn in os.walk('.'):
    dn[:] = [d for d in dn if d not in SKIP]
    for f in fn:
        if not f.endswith('.html'):
            continue
        p = os.path.join(dp, f)
        b = open(p, 'rb').read()
        if TAG.search(b):
            hits.append((p, b))

print('pages carrying the toggle: %d' % len(hits))
for p, _ in hits:
    print('  ', p.replace(os.sep, '/'))

if not apply_:
    print('\n(dry run — re-run with --apply to remove)')
    raise SystemExit(0)

for p, b in hits:
    open(p, 'wb').write(TAG.sub(b'', b, count=1))
    print('cleaned', p.replace(os.sep, '/'))

js = os.path.join('assets', 'js', 'design-toggle.js')
if os.path.exists(js):
    os.remove(js)
    print('deleted', js)

print('\nDone. The toggle is gone; the redesign itself is untouched.')
