var Bluebird    = require("bluebird");
var https       = require("https");
var querystring = require("querystring");
var debug       = require("debug")("opencage");

function confidenceInM (confidence) {
  // http://geocoder.opencagedata.com/api.html#confidence
  var confidenceInM = {
    10: 250,
    9: 500,
    8: 1000,
    7: 5000,
    6: 7500,
    5: 10000,
    4: 15000,
    3: 20000,
    2: 25000,
    1: Number.POSITIVE_INFINITY,
    0: Number.NaN
  };

  return confidenceInM[confidence] || Number.NaN;
}

var PromiseRequest = Bluebird.method(function (options) {
  return new Bluebird (function (resolve, reject) {
    var request = https.request(options, function (response) {

      var result = {
        "httpVersion": response.httpVersion,
        "httpStatusCode": response.statusCode,
        "headers": response.headers,
        "body": "",
        "trailers": response.trailers
      };

      response.on("data", function (chunk) {
        result.body += chunk;
      });

      response.on("end", function () {
        resolve(result);
      });
    });

    request.on("error", function (error) {
      console.log("Problem with request:", error.message);
      reject(error);
    });

    request.end();
  });
});

/*
 * Opencage client varructor
 * @param {Object} options
 *  @config {String} apiKey "xxxx"
 *  @config {String} host - "https://us8.api.mailchimp.com"
 *  @config {String} version - "2.0"
 *  @config {String} format - "json"
 *  @config {Object} logger - a logger function which acts like console.log
 */
var Opencage = function (options) {
  if (!options) {
    throw new Error("options object required");
  }
  if (!options.apiKey) {
    throw new Error("Opencage - no API key given. Please provide an object with a key of apiKey");
  }

  this.apiKey = options.apiKey;
  this.logger = (options.logger || function (){});
  this.apiDomain = this.apiDomain || "api.opencagedata.com";
  this.version = this.version || "v1";
  this.options = options;
};

/*
 * request data from opencagedata
 * @param {Object}  queryOpts  search object
 */
Opencage.prototype.requestData = function (queryOpts = {}) {
  debug("making request", queryOpts);

  queryOpts.key = this.apiKey;

  // openCageData query is encoded as per it's rules. URL encoding should not be done.
  var escapedQueryString = querystring.stringify(queryOpts);
  var unescapedQueryString = querystring.unescape(escapedQueryString);

  return PromiseRequest({
      method: "GET",
      host: this.apiDomain,
      port: 443,
      path: "/geocode/" + this.version + "/json?" + unescapedQueryString
  })
  .catch(function (err) {
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      debug("request error", err);
      if (err.hasOwnProperty("headers")) {
        this.logger("opencagedata:api:X-RateLimit-Reset", err.headers["X-RateLimit-Reset"]);
      }
      return err.response;
    } else {
      throw err;
    }
  })
  .then(function (res) {
    if (res.headers["X-RateLimit-Limit"] || res.headers["X-RateLimit-Remaining"]) {
      this.logger("opencagedata:api:X-RateLimit-Limit", res.headers["X-RateLimit-Limit"]);
      this.logger("opencagedata:api:X-RateLimit-Remaining", res.headers["X-RateLimit-Remaining"]);
    }
    res.body = JSON.parse(res.body);

    if (res.body.status.code !== 200) {
      throw new Error(res.body.status.message);
    }

    debug("Total results returned ", res.body.total_results);
    return res.body.results
      .map(r => Object.assign(r, {confidenceInM: confidenceInM(r.confidence)}))
      .sort((a,b) => (b.confidence - a.confidence));
  });
};


Opencage.prototype.search = function (address, otherOpts) {
  if ([undefined, null, ""].indexOf(address) !== -1) {
    return Bluebird.reject(new Error("INVALID_ADDRESS"));
  } else {

    //This must be URL encoded, ie spaces should be a +, and comma should be %2C.
    address = address.replace(/\s/g, "+").replace(/,/g,"%2C");
    return this.requestData(Object.assign({
      q: address
    }, otherOpts));
  }
};


Opencage.prototype.reverse = function (latitude, longitude, otherOpts) {
  if ([undefined, null, ""].indexOf(latitude) !== -1 || [undefined, null, ""].indexOf(longitude) !== -1) {
    return Bluebird.reject(new Error("INVALID_ADDRESS"));
  } else {
    return this.requestData(Object.assign({
      q: [latitude, longitude].join(",")
    }, otherOpts));
  }
};

module.exports = Opencage;
