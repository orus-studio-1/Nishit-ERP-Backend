import axios from 'axios';

const TALLY_URL = process.env.TALLY_URL || 'http://localhost:9000';

/**
 * Sends a raw XML request to the Tally Server.
 */
export async function sendTallyRequest(xmlPayload: string): Promise<string> {
  try {
    const response = await axios.post(TALLY_URL, xmlPayload, {
      headers: {
        'Content-Type': 'text/xml',
      },
      // Tally sometimes takes time for large masters
      timeout: 30000,
    });
    
    return response.data;
  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error(`Could not connect to Tally at ${TALLY_URL}. Ensure Tally Prime is running and configured for HTTP.`);
    }
    throw new Error(`Tally Request Failed: ${error.message}`);
  }
}
