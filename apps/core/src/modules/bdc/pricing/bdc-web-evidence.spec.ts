import { describe, expect, test, vi } from "vitest";
import type { NormalizedLine } from "./bdc-pricing.types";
import {
  BraveSearchClient,
  MoroccanWebPriceAdapter,
  SafePricePageFetcher,
  type SearchHit,
} from "./bdc-web-evidence";

const line: NormalizedLine = {
  idx: 0,
  category: "fournitures",
  subcategory: "peinture",
  designation: "Peinture acrylique blanche 20 kg",
  specification: "résistante à l'humidité",
  quantity: 5,
  unit: "u",
  region: "Agadir",
  components: [],
  assumptions: [],
  blockers: [],
};

const publicDns = async () => ["196.12.1.20"];

describe("safe price page fetcher", () => {
  test.each([
    "http://bricoma.ma/item",
    "https://user:password@bricoma.ma/item",
    "https://bricoma.ma:8443/item",
    "https://evil.example/item",
  ])("rejects unsafe or non-allowlisted URL %s", async (url) => {
    const fetcher = new SafePricePageFetcher({
      allowHosts: ["bricoma.ma"],
      resolveHost: publicDns,
      fetchImpl: vi.fn(),
    });
    await expect(fetcher.fetch(url)).rejects.toThrow();
  });

  test.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.2.3",
    "192.168.1.2",
    "169.254.10.2",
    "::1",
    "fc00::1",
    "fe80::1",
  ])("rejects private DNS answer %s", async (address) => {
    const fetcher = new SafePricePageFetcher({
      allowHosts: ["bricoma.ma"],
      resolveHost: async () => [address],
      fetchImpl: vi.fn(),
    });
    await expect(fetcher.fetch("https://bricoma.ma/item")).rejects.toThrow(/private/i);
  });

  test("revalidates redirect destinations", async () => {
    const fetcher = new SafePricePageFetcher({
      allowHosts: ["bricoma.ma"],
      resolveHost: publicDns,
      fetchImpl: vi.fn(async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/escape" },
        }),
      ),
    });
    await expect(fetcher.fetch("https://bricoma.ma/item")).rejects.toThrow(/allowlist/i);
  });

  test("stops responses above two megabytes", async () => {
    const fetcher = new SafePricePageFetcher({
      allowHosts: ["bricoma.ma"],
      resolveHost: publicDns,
      fetchImpl: vi.fn(async () =>
        new Response("x".repeat(2 * 1024 * 1024 + 1), {
          headers: { "content-type": "text/html" },
        }),
      ),
    });
    await expect(fetcher.fetch("https://bricoma.ma/item")).rejects.toThrow(/2 MB/i);
  });

  test("aborts a fetch after its configured timeout", async () => {
    const fetcher = new SafePricePageFetcher({
      allowHosts: ["bricoma.ma"],
      resolveHost: publicDns,
      timeoutMs: 10,
      fetchImpl: vi.fn(
        async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    });
    await expect(fetcher.fetch("https://bricoma.ma/item")).rejects.toThrow(/timeout/i);
  });
});

describe("Brave search client", () => {
  test("uses the official endpoint and server-side subscription header", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ web: { results: [{ title: "Produit", url: "https://bricoma.ma/p", description: "500 DH" }] } }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    const client = new BraveSearchClient("secret", fetchImpl);
    const result = await client.search("peinture maroc");

    expect(result).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("api.search.brave.com/res/v1/web/search"),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Subscription-Token": "secret" }),
      }),
    );
  });
});

describe("Moroccan web price evidence", () => {
  test("extracts JSON-LD and visible Moroccan prices with audit metadata", async () => {
    const html = `
      <html><body>
        <script type="application/ld+json">
          {"@type":"Product","name":"Peinture acrylique 20 kg","offers":{"@type":"Offer","price":"600.00","priceCurrency":"MAD"}}
        </script>
        <p>Prix TTC — seau de 10 unités</p>
      </body></html>`;
    const fetcher = new SafePricePageFetcher({
      allowHosts: ["bricoma.ma"],
      resolveHost: publicDns,
      now: () => new Date("2026-07-20T12:00:00.000Z"),
      fetchImpl: vi.fn(async () =>
        new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
      ),
    });
    const search = { search: async (): Promise<SearchHit[]> => [
      { title: "Peinture", url: "https://bricoma.ma/peinture", description: "600 MAD" },
    ] };
    const adapter = new MoroccanWebPriceAdapter(search, fetcher);

    const result = await adapter.search({ line, excludeAvisId: null, limit: 10 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      unitPriceHtMad: 600,
      sourceType: "web",
      sourceUrl: "https://bricoma.ma/peinture",
      observedAt: "2026-07-20T12:00:00.000Z",
      verified: false,
      metadata: {
        taxBasis: "TTC",
        packageQuantity: 10,
        packageUnit: "u",
        extractionMethod: "json_ld_offer",
      },
    });
    expect(result[0]?.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("never accepts a search snippet without a fetched landing-page price", async () => {
    const adapter = new MoroccanWebPriceAdapter(
      { search: async () => [{ title: "Snippet", url: "https://bricoma.ma/no-price", description: "999 DH" }] },
      { fetch: async () => ({ url: "https://bricoma.ma/no-price", html: "<p>Appelez-nous</p>", snapshotHash: "h", fetchedAt: new Date() }) },
    );
    expect(await adapter.search({ line, excludeAvisId: null, limit: 10 })).toEqual([]);
  });

  test("isolates a failed site and keeps evidence from another site", async () => {
    const adapter = new MoroccanWebPriceAdapter(
      {
        search: async () => [
          { title: "Broken", url: "https://bricoma.ma/broken", description: "" },
          { title: "Good", url: "https://marjane.ma/good", description: "" },
        ],
      },
      {
        fetch: async (url: string) => {
          if (url.includes("broken")) throw new Error("site down");
          return {
            url,
            html: "<html><body><h1>Peinture</h1><p>Prix HT: 450,00 DH</p></body></html>",
            snapshotHash: "a".repeat(64),
            fetchedAt: new Date("2026-07-20T12:00:00.000Z"),
          };
        },
      },
    );

    const result = await adapter.search({ line, excludeAvisId: null, limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0]?.unitPriceHtMad).toBe(450);
  });
});
