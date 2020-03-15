const { app, BrowserWindow, screen } = require('electron')

let win

function createWindow() {
	const { width, height } = screen.getPrimaryDisplay().workAreaSize
	win = new BrowserWindow({
		width: width - 20,
		height: height - 20,
		webPreferences: {
			nodeIntegration: true,
		},
	})

	win.loadFile('./dist/index.html')

	if (process.env.DEV === 'true') {
		win.webContents.openDevTools()
	}

	win.on('closed', () => {
		win = null
	})
}

app.on('ready', createWindow)

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit()
	}
})

app.on('activate', () => {
	if (win === null) {
		createWindow()
	}
})
