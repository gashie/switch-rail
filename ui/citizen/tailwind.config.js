import preset from '@sika/shared/tailwind';

export default {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
    '../shared/components/**/*.{js,jsx}',
    '../shared/index.js'
  ]
};
