module.exports = {
	packagerConfig: {
		asar: true,
		icon: './electron/icons/icon',
	},
	rebuildConfig: {},
	makers: [
		{
			name: '@electron-forge/maker-squirrel',
			config: {
				iconUrl: 'https://your-domain.com/icon.ico',
				setupIcon: './electron/icons/icon.ico',
			},
		},
		{
			name: '@electron-forge/maker-zip',
			platforms: ['darwin'],
		},
		{
			name: '@electron-forge/maker-dmg',
			config: {
				icon: './electron/icons/icon.icns',
				background: './electron/icons/dmg-background.png',
				format: 'ULFO',
			},
		},
	],
	publishers: [
		{
			name: '@electron-forge/publisher-github',
			config: {
				repository: {
					owner: 'your-username',
					name: 'dual-deckbuilder',
				},
				prerelease: false,
			},
		},
	],
};
