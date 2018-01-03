const path = require('path');

module.exports = {
    entry: ['babel-polyfill', './src/Upload.js'],
    output: {
        path: path.resolve(__dirname, 'out'),
        filename: 'gcs-browser-upload.js',
        library: "Upload",
        libraryTarget: "umd",
        libraryExport: "default"
    },
    module: {
        rules: [
            {
                use: ['babel-loader'],
                include: [
                    path.resolve(__dirname, "src"),
                ],
                exclude: "/node_modules/",
                test: /\.js$/
            }
        ]
    }
};