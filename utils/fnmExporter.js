/**
 * Fannie Mae 3.2 (.fnm) Exporter Utility
 * Maps 1003 JSON data to legacy fixed-width format.
 * All lines must be exactly 80 characters (newline excluded).
 */

function padRight(str, length) {
    str = (str || '').toString();
    return str.padEnd(length, ' ').substring(0, length);
}

function padLeft(str, length, char = ' ') {
    str = (str || '').toString();
    return str.padStart(length, char).substring(0, length);
}

function formatCurrency(val) {
    if (!val) return padLeft('0', 15);
    return padLeft(Math.round(val).toString(), 15);
}

function generateFNM(app) {
    let lines = [];

    // Header (Record Type 01A - Case Data)
    // 01A + Loan Type (1) + Case Number (15) + ...
    lines.push(`01A${padRight('1', 1)}${padRight(app._id, 15)}${padRight('', 11)}${padLeft(app.loanAmount || 0, 15)}0${padRight('30', 2)}${padRight('01', 2)}`);

    // Property Information (Record Type 02A)
    const addr = app.propertyAddress || '';
    lines.push(`02A${padRight(addr.split(',')[0], 35)}${padRight(addr.split(',')[1] || '', 35)}${padRight(app.propertyDetails?.propertyType || '01', 2)}`);

    // Primary Borrower (Record Type 03A)
    const nameParts = (app.userName || 'Borrower').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
    lines.push(`03A${padRight(firstName, 35)}${padRight(lastName, 35)}${padRight(app.userEmail || '', 7)}`);

    // Present Address (Record Type 04A)
    const firstRes = app.residentialHistory?.[0] || {};
    lines.push(`04A${padRight(firstRes.address || '', 35)}${padRight(firstRes.city || '', 35)}${padRight(firstRes.state || '', 2)}${padRight(firstRes.zip || '', 5)}`);

    // Employment (Record Type 06G)
    if (app.employmentHistory && app.employmentHistory.length > 0) {
        app.employmentHistory.forEach(emp => {
            lines.push(`06G${padRight(emp.employer || '', 35)}${padRight(emp.position || '', 35)}${padRight(emp.startDate || '', 8)}`);
        });
    }

    // Declarations (Record Type 10A)
    const dec = app.declarations || {};
    const decStr = [
        dec.bankruptcy ? 'Y' : 'N',
        dec.foreclosure ? 'Y' : 'N',
        dec.lawsuit ? 'Y' : 'N',
        dec.delinquency ? 'Y' : 'N',
        dec.childSupport ? 'Y' : 'N'
    ].join('');
    lines.push(`10A${padRight(decStr, 13)}`);

    // Ensure every line is padded to 80 chars if needed (simplified here)
    return lines.map(l => l.padEnd(80, ' ')).join('\r\n');
}

module.exports = { generateFNM };
