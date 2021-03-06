/**
 * Created by aleckim on 2014. 7. 14..
 */

"use strict";

var router = require('express').Router();
var passport = require('passport');
var request = require('../controllers/requestEx');

var blogBot = require('./../controllers/blogBot');
var userMgr = require('./../controllers/userManager');

var botFormat = require('../models/botFormat');
var bC = require('../controllers/blogConvert');

var svcConfig = require('../models/svcConfig.json');

var clientConfig = svcConfig.facebook;
var FacebookStrategy = require('passport-facebook').Strategy;
var FACEBOOK_API_URL = "https://graph.facebook.com/v2.0";
var FACEBOOK_PROVIDER = "facebook";

passport.serializeUser(function(user, done) {
    done(null, user);
});

passport.deserializeUser(function(obj, done) {
    done(null, obj);
});

passport.use(new FacebookStrategy({
        clientID: clientConfig.clientID,
        clientSecret: clientConfig.clientSecret,
        callbackURL: svcConfig.svcURL + "/facebook/authorized",
        passReqToCallback : true
    },
    function(req, accessToken, refreshToken, profile, done) {
//        log.debug("accessToken:" + accessToken);
//        log.debug("refreshToken:" + refreshToken);
//        log.debug("profile:" + JSON.stringify(profile));

        var provider = new botFormat.ProviderOauth2(profile.provider, profile.id.toString(), profile.displayName,
            accessToken, refreshToken);

        userMgr.updateOrCreateUser(req, provider, function(err, user, isNewProvider, delUser) {
            if (err) {
                log.error("Fail to get user ");
                return done(err);
            }

            if (delUser) {
                blogBot.combineUser(user, delUser);
                userMgr.combineUser(user, delUser, function(err) {
                    if (err) {
                        return done(err);
                    }
                });
            }

            if (isNewProvider) {
                if (!blogBot.isStarted(user)) {
                    blogBot.start(user);
                }
                else {
                    blogBot.findOrCreate(user);
                }
            }

            process.nextTick(function () {
                return done(null, user);
            });
        });
    }
));

router.get('/authorize',
    passport.authenticate('facebook', {scope: ['user_status', 'user_about_me', 'user_posts', 'user_photos',
                'user_website', 'publish_actions']})
);

router.get('/authorized',
    passport.authenticate('facebook', { failureRedirect: '/#signin' }),
    function(req, res) {
        // Successful authentication, redirect home.
        log.debug('Successful!');
        res.redirect('/#');
    }
);

router.get('/me', function (req, res) {
    var userId = userMgr.getUserId(req, res);
    if (!userId) {
        return;
    }
    var meta = {"cName":FACEBOOK_PROVIDER, "userId":userId, "url":req.url};
    log.info("+", meta);

    userMgr.findProviderByUserId(userId, FACEBOOK_PROVIDER, undefined, function (err, user, provider) {
        if (err) {
            log.error(err, meta);
            return res.status(500).send(err);
        }

        var api_url = FACEBOOK_API_URL+"/me";
        log.debug(api_url);

        _requestGet(api_url, provider.accessToken, function(err, response, body) {
            if (err) {
                log.error(err, meta);
                return res.status(500).send(err);
            }

            log.debug(body);
            res.send(body);
        });
    });
});

router.get('/bot_bloglist', function (req, res) {
    var userId = userMgr.getUserId(req, res);
    if (!userId) {
        return;
    }
    var meta = {"cName":FACEBOOK_PROVIDER, "userId":userId, "url":req.url};
    log.info("+", meta);

    if (req.query.providerid === false) {
        var error = new Error("User: "+userId+" did not have blog!");
        log.debug(error, meta);
        res.status(404).send(error);
        res.redirect("/#/signin");
        return;
    }

    var providerId = req.query.providerid;

    userMgr.findProviderByUserId(userId, FACEBOOK_PROVIDER, providerId, function (err, user, provider) {
        if (err) {
            log.error(err, meta);
            return res.status(500).send(err);
        }

        var apiUrl = FACEBOOK_API_URL+"/"+provider.providerId+"/accounts";
        log.debug(apiUrl);

        _requestGet(apiUrl, provider.accessToken, function(err, response, body) {
            if (err)  {
                log.error(err, meta);
                return res.status(err.statusCode).send(err);
            }

            //log.debug(body, meta);

            var botBlogList = new botFormat.BotBlogList(provider);

            log.debug("pageId: "+provider.providerId+", pageName: feed, pageLink: https://www.facebook.com", meta);

            //user can have unique url for people or pages on facebook
            var botBlog;
            botBlog = new botFormat.BotBlog(provider.providerId, "feed", "https://www.facebook.com");
            botBlogList.blogs.push(botBlog);

            try {
                for (var i = 0; i < body.data.length; i+=1) {
                    var item = body.data[i];
                    var pageId = item.id;
                    var pageName = item.name;
                    var pageLink = "https://www.facebook.com";
                    /*
                     apiUrl = FACEBOOK_API_URL+"/"+pageId;
                     log.debug(apiUrl);
                     _requestGet(apiUrl, p.accessToken, function(err, response, pageBody) {
                     var hasError = _checkError(err, response, pageBody);
                     if (hasError !== undefined) {
                     log.debug("hasError: "+hasError);
                     res.send(hasError);
                     return;
                     }
                     pageLink = pageBody.link;
                     //log.debug("pageId: "+pageId+", pageName: "+pageName+", pageLink: "+pageLink);
                     });
                     */
                    log.debug("pageId: "+pageId+", pageName: "+pageName+", pageLink: "+pageLink);

                    botBlog = new botFormat.BotBlog(pageId, pageName, pageLink);
                    botBlogList.blogs.push(botBlog);
                }
            }
            catch(e) {
                log.error(e, meta);
                log.error(body, meta);
                return res.status(500).send(e);
            }

            res.send(botBlogList);
        });
    });
});

router.get('/bot_post_count/:blog_id', function (req, res) {
    var userId = userMgr.getUserId(req);
    if (!userId) {
        return;
    }
    var meta = {"cName":FACEBOOK_PROVIDER, "userId":userId, "url":req.url};
    log.info("+", meta);

    //facebook did not support post_count.
    var botPostCount = new botFormat.BotPostCount(FACEBOOK_PROVIDER, req.params.blog_id, -1);
    res.send(botPostCount);
});

router.get('/bot_posts/:blog_id', function (req, res) {
    var userId;
    userId = userMgr.getUserId(req, res);
    if (!userId) {
        return;
    }
    var meta = {"cName":FACEBOOK_PROVIDER, "userId":userId, "url":req.url};
    log.info("+", meta);

    var blogId = req.params.blog_id;
    var limit = req.query.limit;
    var until = req.query.until;
    var pagingToken = req.query.__paging_token;

    userMgr.findProviderByUserId(userId, FACEBOOK_PROVIDER, undefined, function (err, user, provider) {
        if (err) {
            log.error(err, meta);
            return res.status(500).send(err);
        }

        var apiUrl = FACEBOOK_API_URL+"/"+blogId+"/posts";
        apiUrl += "?limit=25&";
        /*
        if (limit) {
            apiUrl += "limit="+limit+"&";
        }
        */
        if (until) {
            apiUrl += "until=" + until + "&";
        }

        if (pagingToken) {
            apiUrl += "__paging_token" + pagingToken + "&";
        }

        log.info("apiUrl=" + apiUrl);

        _requestGet(apiUrl, provider.accessToken, function (err, response, body) {
            if (err) {
                log.error(err, meta);
                return res.status(err.statusCode).send(err);
            }

            var botPostList = new botFormat.BotPostList(FACEBOOK_PROVIDER, blogId);

            try {
                if (body.data.length === 25 && body.paging) {
                    botPostList.nextPageToken = body.paging.next;
                }

                botPostList.posts = [];

                for (var i = 0; i<body.data.length; i+=1) {
                    var rawPost = body.data[i];
                    var botPost = {};
                    if (rawPost.message) {
                        botPost = new botFormat.BotTextPost(rawPost.id, ' ', rawPost.updated_time, rawPost.link, '', [],
                                    []);
                        botPostList.posts.push(botPost);
                    }
                }
            }
            catch(e) {
                log.error(e, meta);
                log.error(body, meta);
                return res.status(500).send(e);
            }

            res.send(botPostList);
        });
    });
});


router.get('/bot_posts/:blog_id/:post_id', function (req, res) {
    var userId = userMgr.getUserId(req, res);
    if (!userId) {
        return;
    }
    var meta = {"cName":FACEBOOK_PROVIDER, "userId":userId, "url":req.url};
    log.info("+", meta);

    var blogId = req.params.blog_id;
    var postId = req.params.post_id;

    userMgr.findProviderByUserId(userId, FACEBOOK_PROVIDER, undefined, function (err, user, provider) {
        if (err) {
            log.error(err, meta);
            return res.status(500).send(err);
        }

        var apiUrl = FACEBOOK_API_URL+"/"+postId;

        log.debug(apiUrl, meta);

        _requestGet(apiUrl, provider.accessToken, function(err, response, body) {
            if (err) {
                log.error(err, meta);
                return res.status(err.statusCode).send(err);
            }

            var botPostList = new botFormat.BotPostList(FACEBOOK_PROVIDER, blogId);
            var rawPost = body;

            try {
                var comment_count = 0;
                if (rawPost.comments) {
                    comment_count = rawPost.comments.data.length;
                }

                var like_count = 0;
                if (rawPost.likes) {
                    like_count = rawPost.likes.data.length;
                }

                var replies = [];
                replies.push({"comment":comment_count});
                replies.push({"like":like_count});

                var botPost = new botFormat.BotTextPost(rawPost.id, rawPost.message, rawPost.updated_time, rawPost.link,
                            '', [], [], replies);
                botPostList.posts.push(botPost);
            }
            catch(e) {
                log.error(e, meta);
                log.error(body, meta);
                return res.status(500).send(e);
            }

            res.send(botPostList);
        });
    });
});

router.post('/bot_posts/new/:blog_id', function (req, res) {
    var userId = userMgr.getUserId(req, res);
    if (!userId) {
        return;
    }
    var meta = {"cName": FACEBOOK_PROVIDER, "userId": userId, "url": req.url};
    log.info("+", meta);

    var blogId = req.params.blog_id;
    var botPost = req.body;
    var fbPost = {};
    var convertLinkPost = false;

    var apiUrl = FACEBOOK_API_URL+"/"+blogId;
    var postType = botPost.type;
    if (postType === 'text') {
        if (bC.isHtml(botPost.content)) {
            convertLinkPost = true;
            fbPost.link = botPost.contentUrl;
        }
        else {
            fbPost.message = botPost.content;
            apiUrl += '/feed';
        }
    }
    else if (postType === 'link') {
        fbPost.link = botPost.contentUrl;
        fbPost.message = botPost.description;
        apiUrl += '/feed';
    }
    else if (postType === 'photo') {
        if (botPost.mediaUrls.length === 1) {
            fbPost.url = botPost.mediaUrls[0];
            if (botPost.description) {
                fbPost.caption = botPost.description;
            }
            apiUrl += '/photos';
        }
        else {
            //convert link post or album post
            convertLinkPost = true;
        }
    }
    else if (postType === 'video') {
        if (botPost.videoUrl) {
            fbPost.file_url = botPost.videoUrl;
            if (botPost.title) {fbPost.title = botPost.title;}
            if (botPost.description) {fbPost.description = botPost.description;}
            apiUrl += '/videos';
        }
        else {
            convertLinkPost = true;
        }
    }
    else if (postType === 'audio') {
        convertLinkPost = true;
    }
    else {
        var err = new Error('Unknown postType='+postType);
        log.error(err, meta);
        res.status(500).send(err);
    }

    if (convertLinkPost) {
        fbPost.link = botPost.url;
        if (botPost.description) {fbPost.message = botPost.description;}
        apiUrl += '/feed';
    }

    if (botPost.tags) {
        //add hashTags
        log.silly(botPost.tags, meta);
    }

    userMgr._findProviderByUserId(userId, FACEBOOK_PROVIDER, undefined, function (err, user, provider) {
        if (err) {
            log.error(err, meta);
            return res.status(500).send(err);
        }
        request.postEx(apiUrl, {
            json: true,
            headers: {
                "authorization": "Bearer " + provider.accessToken
            },
            body: fbPost
        }, function (err, response, body) {
            if (err) {
                log.error(err, meta);
                return res.status(err.statusCode).send(err);
            }

            log.silly(body);
            var botPostList = new botFormat.BotPostList(FACEBOOK_PROVIDER, blogId);
            var tags = botPost.tags?botPost.tags:[];
            try {
                //need update for real data
                var newBotPost = new botFormat.BotTextPost(body.id, " ", new Date(0), 'http://', '', [], tags);
                botPostList.posts.push(newBotPost);
            }
            catch(e) {
                log.error(e, meta);
                log.error(body, meta);
                return res.status(500).send(e);
            }

            return res.send(botPostList);
        });
    });
});

router.get('/bot_comments/:blogID/:postID', function (req, res) {
    var userId = userMgr.getUserId(req, res);
    if (!userId) {
        return;
    }
    var meta = {"cName":FACEBOOK_PROVIDER, "userId":userId, "url":req.url};
    log.info("+", meta);

    return res.status(404).send('This API has not supported yet');
});

function _requestGet(url, accessToken, callback) {
    request.getEx(url, {
        json: true,
        headers: {
            "authorization": "Bearer " + accessToken
        }
    }, function (err, response, body) {
        callback(err, response, body);
    });
}

module.exports = router;
