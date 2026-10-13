#!/usr/bin/env python3
"""
Migration script: import CSV email data into service_types.json
Creates services (3rd level) under each subtype with email_to + email_cc.
"""

import csv, json, re, os, hashlib

CSV_PATH = os.path.expanduser('~/Downloads/data Email cc - Sheet1.csv')
JSON_PATH = os.path.join(os.path.dirname(__file__), 'service_types.json')

# Mapping: CSV "Sub type" → service type name in system
SERVICE_TYPE_MAP = {
    # Banks → Service Bank (existing)
    'BBL': 'Service Bank', 'KBANK': 'Service Bank', 'KTB': 'Service Bank',
    'SCB': 'Service Bank', 'SCB Batch File': 'Service Bank', 'BAY': 'Service Bank',
    'GSB': 'Service Bank', 'TTB': 'Service Bank', 'LHBANK': 'Service Bank',
    'KKP': 'Service Bank', 'TBANK': 'Service Bank', 'BAAC': 'Service Bank',
    # Retail
    '7-11 GoSoft': 'Service Retail', '7-11 CS': 'Service Retail',
    "Lotus's": 'Service Retail', 'ForthSmart': 'Service Retail',
    'Makro': 'Service Retail', 'KIOSK': 'Service Retail', 'KIOSK ': 'Service Retail',
    # Batch File
    'Batch File Bpay': 'Batch File', 'Batch File Cashpocket': 'Batch File',
    # ITSC
    'ITSC': 'ITSC', 'ITSC-CCBS': 'ITSC', 'ITSC-CMX': 'ITSC',
    'ITSC-MCP': 'ITSC', 'ITSC-OMX': 'ITSC', 'ITSC-PCS': 'ITSC', 'ITSC-Problem': 'ITSC',
    # MSOM
    'MSOM1': 'MSOM', 'MSOM2': 'MSOM', 'MSOM3': 'MSOM', 'MSOM4': 'MSOM',
    # Nano (existing: "Service Nano")
    'Nano': 'Service Nano',
    # BillPayment (existing)
    'PEA': 'BillPayment', 'MEA': 'BillPayment',
}

def make_id(prefix, name, extra=''):
    h = hashlib.md5((name + extra).encode()).hexdigest()[:8]
    return f"{prefix}_{h}"

def parse_emails(raw):
    if not raw:
        return []
    emails = [e.strip() for e in re.split(r'[,\n]+', raw)]
    return [e for e in emails if '@' in e and e]

def main():
    # Read existing service_types.json
    with open(JSON_PATH, encoding='utf-8') as f:
        types = json.load(f)

    # Read CSV
    rows = []
    with open(CSV_PATH, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)

    # Build lookup: service type name → type object
    type_by_name = {t['name']: t for t in types}

    # Ensure all needed service types exist
    all_needed = set(SERVICE_TYPE_MAP.values())
    all_needed.add('Service Other')  # fallback
    max_order = max((t.get('order', 0) for t in types), default=0)
    for st_name in sorted(all_needed):
        if st_name not in type_by_name:
            max_order += 1
            new_type = {
                'id': make_id('st', st_name),
                'name': st_name,
                'order': max_order,
                'subtypes': []
            }
            types.append(new_type)
            type_by_name[st_name] = new_type
            print(f"  [+] Created service type: {st_name}")

    # Build lookup: (type_name, subtype_name) → subtype object
    def get_subtype(type_name, sub_name):
        t = type_by_name[type_name]
        for s in t['subtypes']:
            if s['name'].strip().lower() == sub_name.strip().lower():
                return s
        # Create new subtype
        max_sub_order = max((s.get('order', 0) for s in t['subtypes']), default=0)
        new_sub = {
            'id': make_id('sst', type_name + sub_name),
            'name': sub_name.strip(),
            'order': max_sub_order + 1,
            'services': []
        }
        t['subtypes'].append(new_sub)
        print(f"  [+] Created subtype: {type_name} > {sub_name}")
        return new_sub

    # Process each CSV row — upsert: create or update
    for row in rows:
        sub_type_raw  = row['Sub type'].strip()
        service_name  = row['Service'].strip()
        email_to      = parse_emails(row.get('Email To', ''))
        email_cc      = parse_emails(row.get('Email CC', ''))
        text_to_email = row.get('Text to Email', '').strip()
        subject       = row.get('Subject', '').strip()

        type_name = SERVICE_TYPE_MAP.get(sub_type_raw, 'Service Other')
        subtype   = get_subtype(type_name, sub_type_raw)

        if 'services' not in subtype:
            subtype['services'] = []

        # Upsert: find existing service or create new
        existing = next(
            (s for s in subtype['services'] if s['name'].strip().lower() == service_name.lower()),
            None
        )
        if existing:
            existing['email_to']      = email_to
            existing['email_cc']      = email_cc
            existing['text_to_email'] = text_to_email
            existing['subject']       = subject
            print(f"  [~] Updated: {sub_type_raw} > {service_name}")
        else:
            max_svc_order = max((s.get('order', 0) for s in subtype['services']), default=0)
            new_svc = {
                'id':            make_id('sv', sub_type_raw + service_name),
                'name':          service_name,
                'email_to':      email_to,
                'email_cc':      email_cc,
                'text_to_email': text_to_email,
                'subject':       subject,
                'order':         max_svc_order + 1
            }
            subtype['services'].append(new_svc)
            print(f"  [+] Service: {sub_type_raw} > {service_name} (to:{len(email_to)} cc:{len(email_cc)})")

    # Write back
    with open(JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(types, f, ensure_ascii=False, indent=2)
    print(f"\nDone. Written to {JSON_PATH}")

if __name__ == '__main__':
    main()
