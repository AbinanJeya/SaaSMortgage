// =========================================================================
// EQUIFAX CANADA PRODUCTION INTEGRATION BOILERPLATE
// =========================================================================
// Instructions:
// 1. Once you are approved by Equifax Canada, put your credentials in .env
// 2. Replace the current Sandbox code in your server.js '/api/credit_pull' 
//    endpoint with this snippet.
// 3. Make sure to install the node-fetch package if you haven't (or use Axios).

async function fetchEquifaxCanadaCreditReport(req) {
    const { firstName, lastName, ssn, dob, addressLine1, city, state, zip } = req.body;

    try {
        console.log('📉 Initiating Real Equifax Canada Credit Pull...');

        // 1. Retrieve the OAuth 2.0 Access Token
        //    (Equifax Canada requires Client Credentials grant)
        const authResponse = await fetch(`${process.env.EQUIFAX_CA_API_URL}oauth/token`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/x-www-form-urlencoded' 
            },
            body: new URLSearchParams({
                'grant_type': 'client_credentials',
                'client_id': process.env.EQUIFAX_CA_CLIENT_ID,
                'client_secret': process.env.EQUIFAX_CA_CLIENT_SECRET
            })
        });

        if (!authResponse.ok) {
            throw new Error(`Equifax Auth Failed: ${authResponse.statusText}`);
        }

        const authData = await authResponse.json();
        const accessToken = authData.access_token;

        // 2. Transmit the Consumer Data to the Equifax Endpoint
        //    Note: The EXACT payload schema will be provided to you by your 
        //    Equifax account manager in the API Integration Guide.
        const reportResponse = await fetch(`${process.env.EQUIFAX_CA_API_URL}credit-report`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                // Customer Reference/Broker Tracking code
                'Efz-Transaction-Id': `JUTHIS-${Date.now()}` 
            },
            body: JSON.stringify({
                consumers: [{
                    name: [
                        { firstName: firstName, lastName: lastName, type: "current" }
                    ],
                    socialNum: [
                        { number: ssn } // SIN Number in Canada
                    ],
                    dateOfBirth: dob,
                    addresses: [
                        {
                            civicNumber: addressLine1.split(' ')[0], // Street number
                            streetName: addressLine1.split(' ').slice(1).join(' '),
                            city: city,
                            province: state, 
                            postalCode: zip
                        }
                    ]
                }],
                // Required score models will depend on your Equifax contract
                // Using FICO Score 8 or Beacon 9.0 (Canada standard)
                models: [
                    { identifier: "beacon_9" } 
                ]
            })
        });

        if (!reportResponse.ok) {
            // Log this securely in prod, never expose raw bureau errors to frontend
            console.error('Equifax Pull Error:', await reportResponse.text());
            throw new Error('Equifax rejected the payload.');
        }

        const reportData = await reportResponse.json();

        // 3. Extract the Credit Score and Report ID
        const resolvedScore = reportData.models[0].score;
        const reportId = reportData.equifaxControlNumber;

        return { score: resolvedScore, reportId: reportId };

    } catch (error) {
        console.error('Production Equifax Integration Error:', error);
        throw error; // Let your Express route catch this and return a 500
    }
}

module.exports = { fetchEquifaxCanadaCreditReport };
