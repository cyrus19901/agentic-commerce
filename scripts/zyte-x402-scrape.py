"""
Zyte x402 scrape helper — uses python-zyte-api with x402 support.
Called by the Node.js ZyteX402Agent via child_process.

Usage:
    python3 scripts/zyte-x402-scrape.py <url> <eth_private_key>

Outputs JSON to stdout.
"""

import asyncio
import json
import sys
import os


async def scrape(url: str, eth_key: str):
    from zyte_api import AsyncZyteAPI

    client = AsyncZyteAPI(eth_key=eth_key)
    print(f"Client: {client}")
    try:
        result = await client.get({"url": url, "browserHtml": True})

        html = result.get("browserHtml", "")
        status_code = result.get("statusCode", 200)

        print(
            json.dumps(
                {
                    "success": True,
                    "url": result.get("url", url),
                    "statusCode": status_code,
                    "html": html,
                    "htmlLength": len(html),
                    "baseTxHash": result.get("x402TxHash") or result.get("baseTxHash"),
                    "paymentAmount": result.get("x402PaymentAmount")
                    or result.get("paymentAmount"),
                }
            )
        )
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
    finally:
        await client.aclose()


def main():
    if len(sys.argv) < 3:
        print(
            json.dumps(
                {
                    "success": False,
                    "error": "Usage: zyte-x402-scrape.py <url> <eth_private_key>",
                }
            )
        )
        sys.exit(1)

    url = sys.argv[1]
    eth_key = sys.argv[2]

    asyncio.run(scrape(url, eth_key))


if __name__ == "__main__":
    main()
