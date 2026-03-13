const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { isServer }) {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, 'src'),
    }
    // xlsx accesses fs/path only at parse time; mark as external on server
    // so the browser bundle gets the full UMD build from the xlsx package.
    if (isServer) {
      config.externals.push({ xlsx: 'commonjs xlsx' })
    }
    return config
  },
}

module.exports = nextConfig
