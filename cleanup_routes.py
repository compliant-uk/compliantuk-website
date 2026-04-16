from pathlib import Path

ROOT = Path('/home/ubuntu/compliantuk-website')
FILES = list(ROOT.glob('*.html'))

replacements = [
    ('index.html#get-compliant', '/#get-compliant'),
    ('/index.html#get-compliant', '/#get-compliant'),
    ('"index.html"', '"/"'),
    ("'index.html'", "'/'"),
    ('/index.html"', '/"'),
    ('/index.html\'', '/\''),
    ('index.html"', '/"'),
    ("index.html'", "/'"),
    ('"blog.html"', '"/blog"'),
    ("'blog.html'", "'/blog'"),
    ('/blog.html', '/blog'),
    ('"about.html"', '"/about"'),
    ("'about.html'", "'/about'"),
    ('/about.html', '/about'),
    ('"contact.html"', '"/contact"'),
    ("'contact.html'", "'/contact'"),
    ('/contact.html', '/contact'),
    ('"privacy.html"', '"/privacy"'),
    ("'privacy.html'", "'/privacy'"),
    ('/privacy.html', '/privacy'),
    ('"terms.html"', '"/terms"'),
    ("'terms.html'", "'/terms'"),
    ('/terms.html', '/terms'),
    ('"bulk.html"', '"/bulk"'),
    ("'bulk.html'", "'/bulk'"),
    ('/bulk.html', '/bulk'),
    ('bulk-upload.html?', '/bulk-upload?'),
    ('"login.html"', '"/login"'),
    ("'login.html'", "'/login'"),
    ('/login.html', '/login'),
    ('"dashboard.html"', '"/dashboard"'),
    ("'dashboard.html'", "'/dashboard'"),
    ('/dashboard.html', '/dashboard'),
    ('blog-post.html?slug=', '/blog-post?slug='),
]

for path in FILES:
    text = path.read_text()
    original = text
    for old, new in replacements:
        text = text.replace(old, new)
    if text != original:
        path.write_text(text)
        print(f'updated {path.name}')
