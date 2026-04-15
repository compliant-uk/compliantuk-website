/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: '/:path*',
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
