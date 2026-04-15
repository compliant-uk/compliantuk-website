async redirects() {
  return [
    {
      source: '/', // Specifically target the homepage
      has: [{ type: 'query', key: 'slug', value: 'official-renters-rights-act-information-sheet-landlord-guide' }],
      destination: '/rra/compliance/information-sheet',
      permanent: true,
    },
    {
      source: '/:path+', // Target all other pages (blog, etc.)
      has: [{ type: 'query', key: 'slug', value: 'official-renters-rights-act-information-sheet-landlord-guide' }],
      destination: '/rra/compliance/information-sheet',
      permanent: true,
    },
  ]
},
