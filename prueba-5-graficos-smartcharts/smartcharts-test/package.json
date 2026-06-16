{
  "name": "deriv-smartcharts-5-test",
  "version": "0.1.0",
  "description": "Prueba Electron con cinco gráficos SmartCharts de Deriv y herramientas de dibujo",
  "main": "main.js",
  "scripts": {
    "start": "npm run build:web && electron .",
    "build:web": "webpack --mode development",
    "pack:win": "npm run build:web && electron-builder --win portable"
  },
  "dependencies": {
    "@deriv/deriv-charts": "2.10.0",
    "moment": "^2.30.1",
    "react": "17.0.2",
    "react-dom": "17.0.2",
    "react-transition-group": "4.4.5"
  },
  "devDependencies": {
    "@babel/core": "^7.26.10",
    "@babel/preset-env": "^7.26.9",
    "@babel/preset-react": "^7.26.3",
    "babel-loader": "^9.2.1",
    "copy-webpack-plugin": "^12.0.2",
    "css-loader": "^7.1.2",
    "electron": "^31.7.7",
    "electron-builder": "^24.13.3",
    "style-loader": "^4.0.0",
    "webpack": "^5.98.0",
    "webpack-cli": "^6.0.1"
  },
  "build": {
    "appId": "com.gabriel.derivsmartcharts5test",
    "productName": "Deriv 5 Graficos Test",
    "directories": {
      "output": "dist"
    },
    "files": [
      "main.js",
      "preload.js",
      "build/**/*",
      "package.json"
    ],
    "win": {
      "target": [
        "portable"
      ]
    }
  }
}
