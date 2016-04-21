var https = require('https');
var fs = require('fs');
var pbotConfig = JSON.parse(fs.readFileSync('./pbot.json', 'utf8'));
var keys = pbotConfig.searchImagesKeys;
var lastKeyIndex = Math.floor(Math.random() * keys.length);

module.exports = {
    searchImages: function(query, then) {
        console.log('Searching images: ' + query)
        var key = keys[lastKeyIndex];
        lastKeyIndex = (lastKeyIndex + 1) % keys.length;
        var url = "https://www.googleapis.com/customsearch/v1?key=" + key + "&q=" + encodeURIComponent(query)
        var body = ""
        https.get(url, function(response) {
            response.on('data', function(chunk) {
                body += chunk;
            });
            response.on('end', function () {
                body = JSON.parse(body);
                console.log(body);
                var items = [];
                if (body.items) for (var i in body.items) {
                    var item = body.items[i];
                    var title = item.title;
                    if (item.pagemap.imageobject) for (var j in item.pagemap.imageobject) {
                        var imageObject = item.pagemap.imageobject[j];
                        if (imageObject.url) {
                            items.push({
                                title: title,
                                url: imageObject.url
                            });
                        }
                    }
                }
                then(null, items);
            });
        }).on('error', function (error) {
            then(error, [])
        })
    }
}
