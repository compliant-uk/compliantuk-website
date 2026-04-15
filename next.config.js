/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: '/blog',
        has: [{ type: 'query', key: 'slug', value: 'information-sheet' }],
        destination: '/rra/compliance/information-sheet',
        permanent: true,
      },
      {
        source: '/blog',
        has: [{ type: 'query', key: 'slug', value: 'proof-of-service' }],
        destination: '/rra/service/certificate-verification',
        permanent: true,
      },
      {
        source: '/blog',
        has: [{ type: 'query', key: 'slug', value: 'agency-bulk' }],
        destination: '/rra/agency/portfolio-tools',
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig

