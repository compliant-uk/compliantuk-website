/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        // This targets the EXACT homepage URL with the slug
        source: '/',
        has: [
          {
            type: 'query',
            key: 'slug',
            value: 'official-renters-rights-act-information-sheet-landlord-guide',
          },
        ],
        destination: '/rra/compliance/information-sheet',
        permanent: true,
      },
      {
        // This targets the slug if it's on ANY other page
        source: '/:path+',
        has: [
          {
            type: 'query',
            key: 'slug',
            value: 'official-renters-rights-act-information-sheet-landlord-guide',
          },
        ],
        destination: '/rra/compliance/information-sheet',
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig
