import { Product } from '@agentic-commerce/shared';

interface EtsySearchParams {
  query: string;
  maxPrice?: number;
  limit?: number;
}

export class EtsyClient {
  private apiKey: string | undefined;
  private useRealAPI: boolean;

  constructor() {
    this.apiKey = process.env.ETSY_API_KEY;
    this.useRealAPI = !!this.apiKey && this.apiKey.length > 0;
    
    if (this.useRealAPI) {
      console.log('✅ Etsy API initialized with real API key');
    } else {
      console.log('⚠️  Etsy API using mock data (add ETSY_API_KEY to .env for real products)');
    }
  }

  private mockProducts: Product[] = [
    {
      id: 'mock-1',
      title: 'Handmade Leather Notebook - Brown',
      description: 'Beautiful handcrafted leather notebook with 200 pages',
      price: 35.99,
      currency: 'USD',
      merchant: 'ArtisanLeatherCo',
      merchantId: 'shop-123',
      url: 'https://etsy.com/listing/mock-1',
      imageUrl: 'https://via.placeholder.com/300x300?text=Leather+Notebook',
      category: 'Paper & Party Supplies',
      inStock: true,
    },
    {
      id: 'mock-2',
      title: 'Vintage Style Leather Journal',
      description: 'Antique-looking leather journal',
      price: 42.50,
      currency: 'USD',
      merchant: 'VintageFinds',
      merchantId: 'shop-456',
      url: 'https://etsy.com/listing/mock-2',
      imageUrl: 'https://via.placeholder.com/300x300?text=Journal',
      category: 'Paper & Party Supplies',
      inStock: true,
    },
    {
      id: 'mock-3',
      title: 'Minimalist Leather Notebook',
      description: 'Simple and elegant',
      price: 28.99,
      currency: 'USD',
      merchant: 'MinimalGoods',
      merchantId: 'shop-321',
      url: 'https://etsy.com/listing/mock-3',
      imageUrl: 'https://via.placeholder.com/300x300?text=Minimal',
      category: 'Office Supplies',
      inStock: true,
    },
    {
      id: 'mock-4',
      title: 'Premium Executive Leather Portfolio',
      description: 'Luxury handcrafted leather portfolio with gold accents and premium Italian leather',
      price: 599.99,
      currency: 'USD',
      merchant: 'LuxuryLeatherGoods',
      merchantId: 'shop-789',
      url: 'https://etsy.com/listing/mock-4',
      imageUrl: 'https://via.placeholder.com/300x300?text=Executive+Portfolio',
      category: 'Office & Business',
      inStock: true,
    },
    {
      id: 'mock-5',
      title: 'Custom Engraved Leather Briefcase',
      description: 'Professional leather briefcase with custom engraving and brass hardware',
      price: 749.00,
      currency: 'USD',
      merchant: 'PremiumCrafts',
      merchantId: 'shop-999',
      url: 'https://etsy.com/listing/mock-5',
      imageUrl: 'https://via.placeholder.com/300x300?text=Leather+Briefcase',
      category: 'Bags & Purses',
      inStock: true,
    },
    {
      id: 'mock-6',
      title: 'Artisan Leather Travel Set',
      description: 'Complete travel set with passport holder, luggage tags, and travel wallet',
      price: 895.50,
      currency: 'USD',
      merchant: 'GlobalArtisans',
      merchantId: 'shop-555',
      url: 'https://etsy.com/listing/mock-6',
      imageUrl: 'https://via.placeholder.com/300x300?text=Travel+Set',
      category: 'Travel & Accessories',
      inStock: true,
    },
    {
      id: 'mock-7',
      title: 'Handcrafted Leather Purse - Crossbody',
      description: 'Beautiful handmade leather crossbody purse with adjustable strap',
      price: 89.99,
      currency: 'USD',
      merchant: 'LeatherCraftStudio',
      merchantId: 'shop-111',
      url: 'https://etsy.com/listing/mock-7',
      imageUrl: 'https://via.placeholder.com/300x300?text=Leather+Purse',
      category: 'Bags & Purses',
      inStock: true,
    },
    {
      id: 'mock-8',
      title: 'Vintage Leather Purse - Brown',
      description: 'Classic vintage-style leather purse with brass clasp',
      price: 125.00,
      currency: 'USD',
      merchant: 'VintageLeather',
      merchantId: 'shop-222',
      url: 'https://etsy.com/listing/mock-8',
      imageUrl: 'https://via.placeholder.com/300x300?text=Vintage+Purse',
      category: 'Bags & Purses',
      inStock: true,
    },
    {
      id: 'mock-9',
      title: 'Luxury Designer Leather Purse - Italian Leather',
      description: 'Luxury designer purse made from premium Italian leather, perfect for special occasions',
      price: 349.99,
      currency: 'USD',
      merchant: 'ItalianLeatherCo',
      merchantId: 'shop-333',
      url: 'https://etsy.com/listing/mock-9',
      imageUrl: 'https://via.placeholder.com/300x300?text=Designer+Purse',
      category: 'Bags & Purses',
      inStock: true,
    },
    {
      id: 'mock-10',
      title: 'Luxury Leather Purse - Hand-Stitched',
      description: 'Premium hand-stitched leather purse with gold hardware',
      price: 650.00,
      currency: 'USD',
      merchant: 'LuxuryBags',
      merchantId: 'shop-444',
      url: 'https://etsy.com/listing/mock-10',
      imageUrl: 'https://via.placeholder.com/300x300?text=Luxury+Purse',
      category: 'Bags & Purses',
      inStock: true,
    },
    {
      id: 'mock-11',
      title: 'Luxury Artisan Leather Tote Purse',
      description: 'Luxury spacious leather tote purse perfect for everyday use with premium finishes',
      price: 299.99,
      currency: 'USD',
      merchant: 'ArtisanBags',
      merchantId: 'shop-666',
      url: 'https://etsy.com/listing/mock-11',
      imageUrl: 'https://via.placeholder.com/300x300?text=Tote+Purse',
      category: 'Bags & Purses',
      inStock: true,
    },
  ];

  async searchProducts(params: EtsySearchParams): Promise<Product[]> {
    // Use real Etsy API if available
    if (this.useRealAPI && this.apiKey) {
      try {
        return await this.searchEtsyAPI(params);
      } catch (error) {
        console.error('Etsy API error, falling back to mock data:', error);
        // Fall through to mock data
      }
    }

    // Mock data fallback
    let results = [...this.mockProducts];

    if (params.query) {
      const queryWords = params.query.toLowerCase().split(' ').filter(w => w.length > 0);
      results = results.filter(p => {
        const titleLower = p.title.toLowerCase();
        const descLower = p.description.toLowerCase();
        // Match if ALL query words appear in title OR description
        return queryWords.every(word => titleLower.includes(word) || descLower.includes(word));
      });
    }

    if (params.maxPrice) {
      results = results.filter(p => p.price <= params.maxPrice!);
    }

    return results.slice(0, params.limit || 10);
  }

  private async searchEtsyAPI(params: EtsySearchParams): Promise<Product[]> {
    const url = new URL('https://openapi.etsy.com/v3/application/listings/active');
    url.searchParams.set('keywords', params.query);
    url.searchParams.set('limit', String(params.limit || 10));
    
    if (params.maxPrice) {
      url.searchParams.set('max_price', String(params.maxPrice * 100)); // Etsy uses cents
    }

    const response = await fetch(url.toString(), {
      headers: {
        'x-api-key': this.apiKey!,
      },
    });

    if (!response.ok) {
      throw new Error(`Etsy API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    
    // Transform Etsy API response to our Product format
    return data.results.map((listing: any) => ({
      id: String(listing.listing_id),
      title: listing.title,
      description: listing.description || '',
      price: listing.price.amount / listing.price.divisor,
      currency: listing.price.currency_code,
      merchant: listing.shop?.shop_name || 'Unknown Shop',
      merchantId: String(listing.shop_id),
      url: listing.url,
      imageUrl: listing.images?.[0]?.url_570xN || '',
      category: listing.taxonomy_path?.[0] || 'General',
      inStock: listing.state === 'active',
    }));
  }

  async getProductById(id: string): Promise<Product | null> {
    return this.mockProducts.find(p => p.id === id) || null;
  }
}
