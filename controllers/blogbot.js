/**
 *
 * Created by aleckim on 2014. 8. 13..
 */

"use strict";

var request = require('./requestEx');

var userMgr = require('./userManager');
var SiteDb = require('../models/blogdb');
var GroupDb = require('../models/groupdb');
var HistoryDb = require('../models/historydb');
var PostDb = require('../models/postdb');

/**
 *
 * @constructor
 */
function BlogBot() {
}

/**
 *
 * @type {[{user: Object, blogDb:Object, groupDb:Object, postDb:Object, historyDb:Object}]}
 */
BlogBot.users = [];

/**
 *
 * @param user
 * @param dbName
 * @returns {Object|*}
 * @private
 */
BlogBot._findDbByUser = function (user, dbName) {
    var meta = {};

    meta.cName = this.name;
    meta.fName = "findDbByUser";
    meta.userId = user._id.toString();

    for (var i=0; i<this.users.length; i+=1) {
        if (this.users[i].user._id === user._id ||
            this.users[i].user._id.toString() === user._id.toString()) {
            switch(dbName) {
                case "blog":
                    return this.users[i].blogDb;
                case "group":
                    return this.users[i].groupDb;
                case "history":
                    return this.users[i].historyDb;
                case "post":
                    return this.users[i].postDb;
                case "all":
                    return this.users[i];
                default:
                    log.error("Unknown dbName:"+dbName, meta);
                    return;
            }
        }
    }
    log.error("Fail to find user", meta);
};

/**
 *
 * @param user
 * @param rcvPosts
 * @private
 */
BlogBot._cbSendPostToBlogs = function (user, rcvPosts) {
    var groupDb;
    var blogId;
    var providerName;
    var post;
    var groups;
    var i;
    var group;
    var j;
    var targetBlog;
    var provider;
    var meta = {};

    //callback일때 this가 undefined인 상태임 by aleckim
    meta.cName = "BlogBot";
    meta.fName = "_cbSendPostToBlogs";
    meta.userId = user._id.toString();

    groupDb = BlogBot._findDbByUser(user, "group");
    blogId = rcvPosts.blog_id;
    providerName = rcvPosts.provider_name;
    post = rcvPosts.posts[0];
    groups = groupDb.findGroupByBlogInfo(providerName, blogId);

    log.debug(providerName, meta);

    for (i = 0; i<groups.length; i+=1) {
        group = groups[i].group;

        for (j=0; j<group.length; j+=1) {
            targetBlog = group[j].blog;
            provider = group[j].provider;

            if (targetBlog.blog_id === blogId && provider.providerName === providerName) {
                log.debug('Skip current blog id='+blogId+' provider='+providerName, meta);
                //skip current blog
                continue;
            }

            log.info('postId='+post.id+' to provider='+provider.providerName+' blog='+targetBlog.blog_id, meta);

            var syncInfo = groupDb.getSyncInfoByBlogInfo(i, providerName, blogId, provider.providerName,
                targetBlog.blog_id);
            //var postType = "post";

            if (syncInfo) {
                if (syncInfo.syncEnable !== 'true') {
                    continue;
                }
                //postType is decided by system(depend type of source post
                //postType = syncInfo.postType;
            }
            {
                var bC = require('./blogConvert');
                bC.mergeTagsCategories(post.categories, targetBlog.categories, post.tags);
            }

            //syncInfo.postType에 따라 post 처리
            BlogBot._requestPostContent(user, post, provider.providerName, targetBlog.blog_id,
                function(err, user, newPosts) {
                    if(err) {
                        log.error("Fail to post content", meta);
                        return;
                    }

                    var oPostInfo = {};
                    oPostInfo.providerName = rcvPosts.provider_name;
                    oPostInfo.blogId = rcvPosts.blog_id;
                    oPostInfo.postId = rcvPosts.posts[0].id.toString();
                    BlogBot._cbAddPostInfoToDb(user, newPosts, oPostInfo);
                }
            );
        }
    }
};

/**
 *
 * @param user
 * @param rcvPosts
 * @private
 */
BlogBot._cbPushPostsToBlogs = function(user, rcvPosts) {
    var postDb;
    var i;
    var newPost;
    var postDbIsUpdated = false;
    var meta = {};

    meta.cName = "BlogBot";
    meta.fName = "_cbPushPostsToBlogs";
    meta.userId = user._id.toString();

    postDb = BlogBot._findDbByUser(user, "post");

    log.silly(rcvPosts.posts, meta);

    if(!rcvPosts.posts) {
        log.error("Length is undefined !!!", meta);
        return;
    }

//TODO: if post count over max it need to extra update - aleckim
    for(i=0; i<rcvPosts.posts.length;i+=1) {
        newPost = rcvPosts.posts[i];
        if (postDb.isPostByPostIdOfBlog(rcvPosts.provider_name, rcvPosts.blog_id, newPost.id.toString())) {
            log.debug("This post was already saved - provider=" +
                    rcvPosts.provider_name + " blog=" + rcvPosts.blog_id + " post=" + newPost.id, meta);
            continue;
        }

        postDb.addPost(rcvPosts.provider_name, rcvPosts.blog_id, newPost);
        postDbIsUpdated = true;
        //get only one post for send to dstBlog
        BlogBot._requestGetPosts(user, rcvPosts.provider_name, rcvPosts.blog_id, {"post_id":newPost.id},
            function(err, user, rcvPosts) {
                if (err)  {
                    log.error(err, meta);
                    return;
                }

                BlogBot._cbSendPostToBlogs(user, rcvPosts);
            }
        );
        //push post to others blog and addPostInfo
    }

    //log.info(postDb.posts, meta);
    if (postDbIsUpdated) {
        postDb.save(function (err) {
            if (err) {
                log.error("Fail to save postDb", meta);
            }
            else {
                log.info("Save is success", meta);
            }
        });
    }
};

/**
 *
 * @param user
 * @private
 */
BlogBot._getAndPush = function(user) {
    var blogDb;
    var postDb;
    var groupDb;
    var sites;
    var after;
    var i;
    var j;
    var groups;
    var meta = {};

    meta.cName = this.name;
    meta.fName = "_getAndPush";
    meta.userId = user._id.toString();

    log.info(" ", meta);
    blogDb = BlogBot._findDbByUser(user, "blog");
    postDb = BlogBot._findDbByUser(user, "post");
    groupDb = BlogBot._findDbByUser(user, "group");

    if (!blogDb || !postDb || !groupDb) {
        log.error("Fail to find blogDb or postDb or groupDb", meta);
        return;
    }

    sites = blogDb.sites;
    after = postDb.lastUpdateTime.toISOString();
    //log.debug(after, meta);

    for (i=0; i<sites.length; i+=1) {
        for (j=0; j<sites[i].blogs.length; j+=1) {

            //if this blog was not grouped pass
            groups = groupDb.findGroupByBlogInfo(sites[i].provider.providerName, sites[i].blogs[j].blog_id);
            if (groups.length === 0) {
               log.info("It has not group provider="+sites[i].provider.providerName +
                        " blog="+sites[i].blogs[j].blog_id, meta);
               continue;
            }

            BlogBot._requestGetPosts(user, sites[i].provider.providerName, sites[i].blogs[j].blog_id,
                {"after": after}, function(err, user, rcvPosts) {
                    if (err) {
                        log.error(err, meta);
                        return;
                    }
                    BlogBot._cbPushPostsToBlogs(user, rcvPosts);
                });
        }
    }
    postDb.lastUpdateTime = new Date();
};

BlogBot._updateProviderInfo = function (user, provider) {
    for (var i=0; i<this.users.length; i+=1) {
        if (this.users[i].user._id !== user._id) {
            continue;
        }
        for (var j=0; j<this.users[i].user.providers.length; j+=1) {
            if (this.users[i].user.providers[j].providerName !== provider.providerName) {
                continue;
            }
            this.users[i].user.providers[j] = provider;
        }
    }
};

BlogBot._updateAccessToken = function (user) {
    var meta = {};
    meta.cName = this.name;
    meta.fName = "_updateAccessToken";
    meta.userId = user._id.toString();

    //check sign up time for update token
    for (var j=0; j<user.providers.length; j+=1) {
        var provider = user.providers[j];
        if (!provider.tokenExpireTime) {
            continue;
        }

        var limitTime = provider.tokenExpireTime;
        var currentTime = new Date();
        currentTime.setMinutes(currentTime.getMinutes()+10);
        if (limitTime > currentTime) {
            continue;
        }

        log.debug("provider="+provider.providerName+" limitTime="+limitTime.toString(), meta);

        var url = "http://www.justwapps.com/"+provider.providerName + "/bot_posts/updateToken";
        url += "?";
        url += "userid=" + user._id;
        request.postEx(url, null, function (err, response, body) {
            if (err)  {
                log.error(err, meta);
                //BlogBot._addHistory(user, post, err.statusCode);
                return;
            }
            log.debug(body, meta);
            //you can't direct update though provider
            BlogBot._updateProviderInfo(user, JSON.parse(body));
        });
    }
};

/**
 *
 */
BlogBot.task = function() {
    var i;
    var user;
    var meta = {};

    meta.cName = this.name;
    meta.fName = "task";
    log.info("Start users=" + this.users.length, meta);
    for (i=0; i<this.users.length; i+=1)  {
        user = this.users[i].user;
        BlogBot._getAndPush(user);
        BlogBot._updateAccessToken(user);
    }
};

/**
 *
 */
BlogBot.load = function () {
    var meta = {};

    meta.cName = this.name;
    meta.fName = "load";

    userMgr.findUsers(function(err, users) {
        var i;

        if (err) {
            log.error(err, meta);
            return;
        }

        for (i=0; i<users.length; i+=1) {
            BlogBot.start(users[i]);
        }
    });
};

/**
 *
 * @param {User} user
 */
BlogBot.start = function (user) {
    var userInfo;
    var newSiteDb;
    var newGroupDb;
    var newHistoryDb;
    var newPostDb;
    var meta = {};

    meta.cName = this.name;
    meta.fName = "start";
    meta.userId = user._id.toString();

    log.info(" ", meta);
    userInfo = {};
    userInfo.user = user;

    SiteDb.findOne({userId:user._id}, function (err, siteDb) {
        if (err) {
            log.error(err, meta);
            return;
        }
        if (siteDb) {
            userInfo.blogDb = siteDb;
        }
        else {
            newSiteDb = new SiteDb();
            newSiteDb.userId = user._id;
            userInfo.blogDb = newSiteDb;

            newSiteDb.save(function (err) {
                if (err) {
                    log.error(err, meta);
                }
            });
            log.info("Make new siteDb", meta);
            BlogBot.findOrCreate(user);
        }
    });

    GroupDb.findOne({userId:user._id}, function (err, groupDb) {
        if (err) {
            log.error("Fail to find groupDb", meta);
            return;
        }
        if (groupDb) {
            userInfo.groupDb = groupDb;
        }
        else {
            newGroupDb = new GroupDb();
            newGroupDb.userId = user._id;
            userInfo.groupDb = newGroupDb;
            newGroupDb.save(function (err) {
                if (err) {
                    log.error("Fail to save new groupDb", meta);
                }
            });
            log.info("Make new groupDb", meta);
        }
    });

    HistoryDb.findOne({userId:user._id}, function (err, historyDb) {
        if (err) {
            log.error("Fail to find historyDb", meta);
            return;
        }
        if (historyDb) {
            userInfo.historyDb = historyDb;
        }
        else {
            newHistoryDb = new HistoryDb();
            newHistoryDb.userId = user._id;
            userInfo.historyDb = newHistoryDb;
            newHistoryDb.save(function (err) {
                if (err) {
                    log.error("Fail to save new historyDb", meta);
                }
            });
            log.info("Make new historyDb", meta);
        }
    });

    PostDb.findOne({userId:user._id}, function (err, postDb) {
        if (err) {
            log.error("Fail to find postDb", meta);
            return;
        }
        if (postDb) {
            userInfo.postDb = postDb;
        }
        else {
            newPostDb = new PostDb();
            newPostDb.userId = user._id;
            newPostDb.lastUpdateTime = new Date();
            newPostDb.posts = [];
            userInfo.postDb = newPostDb;
            newPostDb.save(function (err) {
                if (err) {
                    log.error("Fail to save new postDb", meta);
                }
            });
            log.info("Make new postDb", meta);
        }
    });

    this.users.push(userInfo);
};

/**
 *
 * @todo _id 비교문을 하나로 합치자.
 * @param {User} user
 * @returns {boolean}
 */
BlogBot.isStarted = function (user) {
    var i;
    var meta = {};

    meta.cName = this.name;
    meta.fName = "isStarted";
    meta.userId = user._id.toString();

    for(i=0; i<this.users.length; i+=1) {
        if (this.users[i].user._id === user._id ||
            this.users[i].user._id.toString() === user._id.toString()) {
            return true;
        }
    }

    log.warn("Fail to find user in blogBot", meta);
    return false;
};

/**
 *
 * @param {User} user
 */
BlogBot.stop = function (user) {
    var i;
    var meta = {};

    meta.cName = this.name;
    meta.fName = "stop";
    meta.userId = user._id.toString();

    for(i=0; i<this.users.length; i+=1) {
        if (this.users[i].user._id === user._id ||
            this.users[i].user._id.toString() === user._id.toString()) {
            this.users.splice(i, 1);
            return;
        }
    }

    log.debug(" ", meta);
};

/**
 *
 * @param {User} user
 * @param {User} delUser
 */
BlogBot.combineUser = function (user, delUser) {
    var userInfo;
    var delUserInfo;
    var meta = {};

    meta.cName = this.name;
    meta.fName = "combineUser";

    log.info(" ", meta);

    userInfo = BlogBot._findDbByUser(user, "all");
    delUserInfo = BlogBot._findDbByUser(delUser, "all");
    if (!userInfo || !delUserInfo) {
        return;
    }

    if (delUserInfo.blogDb) {
        if (!userInfo.blogDb) {
            userInfo.blogDb = new SiteDb();
            userInfo.blogDb.userId = user._id;
        }

        userInfo.blogDb.sites = userInfo.blogDb.sites.concat(delUserInfo.blogDb.sites);
        delUserInfo.blogDb.remove();
        userInfo.blogDb.save(function (err) {
            if (err) {
                log.error("Fail to save sites", meta);
            }
        });
    }

    if (delUserInfo.groupDb) {
        if (!userInfo.groupDb) {
            userInfo.groupDb = new GroupDb();
            userInfo.groupDb.userId = user._id;
        }

        userInfo.groupDb.groups = userInfo.groupDb.groups.concat(delUserInfo.groupDb.groups);
        delUserInfo.groupDb.remove();
        userInfo.groupDb.save(function (err) {
            if (err) {
                log.error("Fail to save groups", meta);
            }
        });
    }

    if (delUserInfo.historyDb) {
        if (!userInfo.historyDb) {
            userInfo.historyDb = new HistoryDb();
            userInfo.historyDb.userId = user._id;
        }

        userInfo.historyDb.histories = userInfo.historyDb.histories.concat(delUserInfo.historyDb.histories);
        delUserInfo.historyDb.remove();
        userInfo.historyDb.save(function (err) {
            if (err) {
                log.error("Fail to save histories", meta);
            }
        });
    }

    //it will activation when collectfeedback milestone
    //var i, j, isAdded;
    //if (delUserInfo.postDb) {
    //    if (!userInfo.postDb) {
    //        userInfo.postDb = new PostDb();
    //        userInfo.postDb.userId = user._id;
    //        userInfo.postDb.lastUpdateTime = delUserInfo.postDb.lastUpdateTime;
    //        userInfo.postDb.posts = userInfo.postDb.posts.concat(delUserInfo.postDb.posts);
    //    }
    //    else {
    //        if (userInfo.postDb.lastUpdateTime.getTime() > delUserInfo.postDb.lastUpdateTime.getTime()) {
    //            userInfo.postDb.lastUpdateTime = delUserInfo.postDb.lastUpdateTime;
    //        }
    //
    //        for (i = delUserInfo.postDb.posts.length - 1; i >= 0; i -= 1) {
    //            isAdded = false;
    //            for (j = userInfo.postDb.posts.length - 1; j >= 0; j -= 1) {
    //                //title is not key any more.
    //                if (userInfo.postDb.posts[j].title === delUserInfo.postDb.posts[i].title) {
    //                    userInfo.postDb.posts[j].infos = userInfo.postDb.posts[j].infos.concat(delUserInfo.postDb.posts[i].infos);
    //                    isAdded = true;
    //                    break;
    //                }
    //            }
    //            if (isAdded === false) {
    //                userInfo.postDb.posts.push(delUserInfo.postDb.posts[i]);
    //            }
    //        }
    //    }
    //
    //    delUserInfo.postDb.remove();
    //    userInfo.postDb.save(function (err) {
    //        if (err) {
    //            log.error(err, meta);
    //        }
    //    });
    //}

    BlogBot.stop(delUser);
};

/**
 *
 * @param {User} user
 * @param {{provider: object, blogs: [{blogId: string, blogTitle: string, blogUrl: string}]}} recvBlogs
 * @private
 */
BlogBot._cbAddBlogsToDb = function (user, recvBlogs) {
    var provider;
    var blogs;
    var blogDb;
    var i;
    var site;
    var blog;
    var meta = {};

    meta.cName = "BlogBot";
    meta.fName = "_cbAddBlogsToDb";
    meta.userId = user._id.toString();

    provider = recvBlogs.provider;
    if (!provider) {
        log.error("Provider is undefined", meta);
        return;
    }
    blogs = recvBlogs.blogs;

    log.debug(provider, meta);
    log.info(blogs, meta);

    blogDb = BlogBot._findDbByUser(user, "blog");
    if (!blogDb) {
        log.error("Fail to find blogDb", meta);
        return;
    }

    site = blogDb.findSiteByProvider(provider.providerName, provider.providerId);
    if (site) {
        for (i=0; i<blogs.length; i+=1) {
            blog = blogDb.findBlogFromSite(site, blogs[i].blog_id.toString());
            if (!blog) {
                site.blogs.push(blogs[i]);
                BlogBot._requestGetPostCount(user, site.provider.providerName, blogs[i].blog_id,
                    function (err, user, rcvPostCount) {
                        if (err) {
                            log.error(err, meta);
                            return;
                        }
                        BlogBot._cbAddPostsFromNewBlog(user, rcvPostCount);
                    });
            }
        }
    }
    else {
        blogDb.sites.push({"provider": provider, "blogs": blogs});
        for (i=0; i<blogs.length; i+=1) {
            BlogBot._requestGetPostCount(user, provider.providerName, blogs[i].blog_id,
                function (err, user, rcvPostCount) {
                    if (err) {
                        log.error(err, meta);
                        return;
                    }
                    BlogBot._cbAddPostsFromNewBlog(user, rcvPostCount);
                });
        }
    }
    blogDb.save(function(err) {
        if (err) {
            log.error(err, meta);
        }
    });
    log.debug("Provider Name=" + provider.providerName + " Id=" + provider.providerId, meta);
};

/**
 *
 * @param {User} user
 */
BlogBot.findOrCreate = function (user) {
    var i;
    var p;
    var meta={};

    meta.cName = this.name;
    meta.fName = "findOrCreate";
    meta.userId = user._id.toString();

    log.debug("Find or create blog db", meta);

    for (i=0; i<user.providers.length; i+=1)
    {
        p = user.providers[i];
        BlogBot._requestGetBlogList(user, p.providerName, p.providerId, function (err, user, rcvBlogs) {
            if (err) {
                log.error(err, meta);
                return;
            }
            BlogBot._cbAddBlogsToDb(user, rcvBlogs);
        });
    }
};

/**
 *
 * @param user
 * @returns {Object|*}
 */
BlogBot.getSites = function (user) {
    var meta={};

    meta.cName = this.name;
    meta.fName = "getSites";
    meta.userId = user._id.toString();

    log.debug(" ", meta);
    return BlogBot._findDbByUser(user, "blog");
};

/**
 *
 * @param user
 * @param group
 * @param groupInfo
 */
BlogBot.addGroup = function(user, group, groupInfo) {
    var groupDb;
    var meta={};

    meta.cName = this.name;
    meta.fName = "addGroup";
    meta.userId = user._id.toString();

    if (!group) {
        log.error("Group is undefined", meta);
    }

    log.info("Group len="+group.length, meta);
    groupDb = BlogBot._findDbByUser(user, "group");
    groupDb.groups.push({"group":group, "groupInfo":groupInfo});
    groupDb.save(function (err) {
       if (err)  {
           log.error("Fail to save group in addGroup", meta);
           log.error(" "+err.toString(), meta);
       }
    });
};

/**
 *
 * @param user
 * @param groups
 */
BlogBot.setGroups = function(user, groups) {
    var groupDb;
    var meta={};

    meta.cName = this.name;
    meta.fName = "setGroups";
    meta.userId = user._id.toString();

    groupDb = BlogBot._findDbByUser(user, "group");
    groupDb.groups = groups;
    groupDb.save(function (err) {
        if (err)  {
            log.error("Fail to save group in addGroup", meta);
        }
    });
};

/**
 *
 * @param user
 * @returns {groupSchema.groups|*|groups|Array}
 */
BlogBot.getGroups = function(user) {
    var groupDb = BlogBot._findDbByUser(user, "group");
    return groupDb.groups;
};

/**
 *
 * @param user
 * @param rcvPosts
 * @param oPostInfo
 * @private
 */
BlogBot._cbAddPostInfoToDb = function (user, rcvPosts, oPostInfo) {
    var postDb;
    var post;
    var meta={};

    meta.cName = "BlogBot";
    meta.fName = "_cbAddPostInfoToDb";
    meta.userId = user._id.toString();

    if (!rcvPosts.posts) {
        log.error("Broken posts", meta);
        return;
    }

    if (!rcvPosts.posts[0].title) {
        log.debug("Fail to find title !!", meta);
    }

    postDb = BlogBot._findDbByUser(user, "post");
    post = postDb.getPostByPostIdOfBlog(oPostInfo.providerName, oPostInfo.blogId, oPostInfo.postId);
    if (!post) {
        log.error("Fail to found post by providerName="+oPostInfo.providerName+" blogId="+oPostInfo.blogId+
                " postId="+oPostInfo.postId, meta);
        return;
    }

    postDb.addPostInfo(post, rcvPosts.provider_name, rcvPosts.blog_id, rcvPosts.posts[0]);
    postDb.save(function (err) {
        if (err) {
            log.error("Fail to save postDb", meta);
        }
    });

    log.info(" !!! ", meta);
};

/**
 *
 * @param user
 * @param rcvPosts
 * @private
 */
BlogBot._cbAddPostsToDb = function(user, rcvPosts) {
    var postDb;
    var i;
    var post;
    var meta={};

    meta.cName = "BlogBot";
    meta.fName = "_cbAddPostsToDb";
    meta.userId = user._id.toString();

    if (!rcvPosts || !rcvPosts.posts) {
        log.error("Fail to get rcvPosts", meta);
        return;
    }

    log.debug("+ posts="+rcvPosts.posts.length, meta);

    postDb = BlogBot._findDbByUser(user, "post");

    //TODO: change from title to id
    for (i=0; i<rcvPosts.posts.length; i+=1) {
        var rcvPost = rcvPosts.posts[i];

        //check there is post
        if (postDb.isPostByPostIdOfBlog(rcvPosts.provider_name, rcvPosts.blog_id, rcvPost.id.toString())) {
            log.verbose("This post was already saved - provider=" + rcvPosts.provider_name + " blog=" +
                    rcvPosts.blog_id + " post=" + rcvPost.id, meta);
            continue;
        }

        //log.debug(" " + rcvPosts.posts[i], meta);
        //if there is same title in postdb, add new in post object what has same title.
        //we need check by new item. we will do when collect feedback milestone
        //if (rcvPost.title) {
        //    post = postDb.findPostByTitle(rcvPost.title);
        //
        //    //log.debug(rcvPosts.provider_name + rcvPosts.blog_id + rcvPosts.posts[i], meta);
        //    if (post) {
        //        postDb.addPostInfo(post, rcvPosts.provider_name, rcvPosts.blog_id, rcvPost);
        //        continue;
        //    }
        //}

        postDb.addPost(rcvPosts.provider_name, rcvPosts.blog_id, rcvPost);
    }

    postDb.save(function (err) {
        if (err) {
            log.error("Fail to save postDb", meta);
        }
    });
};

/**
 *
 * @param user
 * @param providerName
 * @param blogId
 * @param options
 * @param {function} callback - _cbAddPostsToDb
 * @private
 */
BlogBot._recursiveGetPosts = function(user, providerName, blogId, options, callback) {
    var index;
    var newOpts;
    var meta = {};

    meta.cName = this.name;
    meta.fName = "_recursiveGetPosts";
    meta.userId = user._id.toString();

    BlogBot._requestGetPosts(user, providerName, blogId, options, function (err, user, rcvPosts) {
        if (err) {
            log.error(err, meta);
            return callback(err);
        }

        if (!rcvPosts || !rcvPosts.posts) {
            var error = new Error("Fail to get rcvPosts or rcvPosts.posts");
            error.statusCode = 500;
            log.error(error, meta);
            log.error(rcvPosts, meta);
            return callback(error);
        }

        callback(null, user, rcvPosts);

        index = rcvPosts.posts.length-1;
        newOpts = {};

        if(providerName === "twitter") {
            if (rcvPosts.stopReculsive) {
                log.info(providerName+": Stop recursive call functions", meta);
                return;
            }
            newOpts.offset = rcvPosts.posts[index].id;
            log.debug(providerName+": get posts", meta);
        }
        else if(providerName === "kakao") {
            if (!rcvPosts.posts.length) {
                log.info(providerName+": Stop recursive call functions", meta);
                return;
            }
            newOpts.offset = rcvPosts.posts[index].id;
            log.debug(providerName + ": get posts", meta);
        }
        else if(providerName === "facebook" || providerName === "google") {
            if (!rcvPosts.nextPageToken) {
                log.info(providerName+"-"+rcvPosts.blog_id+": Stop recursive call functions", meta);
                return;
            }

            if (providerName === "google" && options.offset) {
                newOpts.offset = options.offset;
            }

            newOpts.nextPageToken = rcvPosts.nextPageToken;
            log.debug(providerName+": nextPageToken: "+newOpts.nextPageToken, meta);

        }
        else {
           log.error(providerName+": we didn't have this case!!", meta);
            return;
        }

        BlogBot._recursiveGetPosts(user, providerName, blogId, newOpts, callback);
    });
};

/**
 *
 * @param user
 * @param rcvPostCount
 * @private
 */
BlogBot._cbAddPostsFromNewBlog = function(user, rcvPostCount) {
    var providerName;
    var blogId;
    var postCount;
    var i;
    var offset;
    var meta = {};

    meta.cName = "BlogBot";
    meta.fName = "_cbAddPostsFromNewBlog";
    meta.userId = user._id.toString();

    log.debug(" ", meta);

    if (!rcvPostCount) {
        log.error("Fail to get rcvPostCount", meta);
        return;
    }

    providerName = rcvPostCount.provider_name;
    blogId =  rcvPostCount.blog_id;
    postCount = rcvPostCount.post_count;

    //how many posts get per 1 time.
    /* Todo : 모두 하나로 통일 필요. */

    var options = {};

    if (providerName === 'google') {
        options.offset = '0-20'; //page count isn't used
    }
    else if(providerName === "twitter" || postCount < 0) { //kakao, maybe facebook
        // twitter use max_id, so recursiveGetPosts must be called.
        log.debug("postCount didn't supported", meta);
    }
    else if (postCount > 0) {
        for (i=0; i<postCount; i+=20) {
            offset = i + '-20';
            options.offset = offset;
            BlogBot._requestGetPosts(user, providerName, blogId, options, function (err, user, rcvPosts) {
                if (err) {
                    log.error(err, meta);
                    return;
                }

                return BlogBot._cbAddPostsToDb(user, rcvPosts);
            });
        }

        return; //stop this function
    }

    BlogBot._recursiveGetPosts(user, providerName, blogId, options, function (err, user, rcvPosts) {
        if (err)  {
            log.error(err, meta);
            return;
        }

        return BlogBot._cbAddPostsToDb(user, rcvPosts);
    });
};

/**
 *
 * @param user
 * @param {string} providerName
 * @param {string} providerId
 * @param {function} callback
 * @private
 */
BlogBot._requestGetBlogList = function(user, providerName, providerId, callback) {
    var url;
    var meta={};

    meta.cName = this.name;
    meta.fName = "_requestGetBlogList";
    meta.userId = user._id.toString();

    url = "http://www.justwapps.com/" + providerName + "/bot_bloglist";
    url += "?";
    url += "providerid=" + providerId;
    url += "&";

    url += "userid=" + user._id;

    log.debug("Url=" + url, meta);
    request.getEx(url, null, function (err, response, body) {
        if (err)  {
            log.error(err, meta);
            return callback(err);
        }

        var rcvBlogs;
        try {
            rcvBlogs = JSON.parse(body);
        }
        catch(e) {
            e.exMessage = "Fail to parse body";
            e.statusCode = 500;
            log.error(e, meta);
            log.error(body, meta);
            return callback(e);
        }

        return callback(null, user, rcvBlogs);
    });
};

/**
 *
 * @param user
 * @param {string} providerName
 * @param {string} blogId
 * @param {function} callback
 * @private
 */
BlogBot._requestGetPostCount = function(user, providerName, blogId, callback) {
    var url;
    var meta={};

    meta.cName = this.name;
    meta.fName = "_requestGetPostCount";
    meta.userId = user._id.toString();

    url = "http://www.justwapps.com/"+providerName + "/bot_post_count/";
    url += blogId;
    url += "?";
    url += "userid=" + user._id;

    log.debug("Url=" + url, meta);
    request.getEx(url, null, function (err, response, body) {
        if (err)  {
            log.error(err, meta);
            return callback(err);
        }

        var rcvPostCount;
        try {
            rcvPostCount = JSON.parse(body);
        }
        catch(e) {
            e.exMessage = "Fail to parse body";
            e.statusCode = 500;
            log.error(e, meta);
            log.error(body, meta);
            return callback(e);
        }

        return callback(null, user, rcvPostCount);
    });
};

/**
 *
 * @param user
 * @param {string} providerName
 * @param {string} blogId
 * @param {Object} options
 * @param {function} callback
 * @private
 */
BlogBot._requestGetPosts = function(user, providerName, blogId, options, callback) {
    var url;
    var meta={};

    meta.cName = this.name;
    meta.fName = "_requestGetPosts";
    meta.userId = user._id.toString();

    url = "http://www.justwapps.com/"+providerName + "/bot_posts/";
    url += blogId;

    if (options.post_id) {
        url += "/" + options.post_id;
    }

    url += "?";

    if (options.after) {
        url += "after=" + options.after;
        url += "&";
    }
    if (options.offset) {
        url += "offset="+options.offset;
        url += "&";
    }
    if (options.nextPageToken) {
        url += "nextPageToken="+options.nextPageToken;
        url += "&";
    }

    url += "userid=" + user._id;

    log.debug("Url=" + url, meta);

    request.getEx(url, null, function (err, response, body) {
        if (err)  {
            log.error(err, meta);
            return callback(err);
        }

        var rcvPosts;
        try {
            rcvPosts = JSON.parse(body);
        }
        catch(e) {
            e.exMessage = "Fail to parse body";
            e.statusCode = 500;
            log.error(e, meta);
            log.error(body, meta);
            return callback(e);
        }

        callback(null, user, rcvPosts);
    });
};

/**
 *
 * @param user
 * @returns {Array}
 */
BlogBot.getHistories = function (user) {
    var historyDb;
    var meta={};

    meta.cName = this.name;
    meta.fName = "getHistories";
    meta.userId = user._id.toString();

    historyDb = BlogBot._findDbByUser(user, "history");
    if (historyDb) {
        log.info("Histories length="+historyDb.histories.length, meta);
        return historyDb.histories;
    }
    else {
        log.error("Fail to find historyDb", meta);
    }
};

/**
 *
 * @param user
 * @param srcPost
 * @param postStatus
 * @param dstPost
 * @private
 */
BlogBot._addHistory = function(user, srcPost, postStatus, dstPost) {
    var history;
    var historyDb;
    var src;
    var dst;
    var meta={};

    meta.cName = this.name;
    meta.fName = "_addHistory";
    meta.userId = user._id.toString();

    log.debug(" ", meta);
    historyDb = BlogBot._findDbByUser(user, "history");

    if (srcPost) {
        src = {};
        src.title = srcPost.title;
        src.id = srcPost.id;
        src.url = srcPost.url;
    }
    if (dstPost) {
        dst = {};
        dst.id = dstPost.id;
        dst.url = dstPost.url;
    }

    history = {};
    history.tryTime = new Date();
    history.status = postStatus;
    history.src = src;
    history.dst = dst;

    historyDb.histories.push(history);
    historyDb.save(function (err) {
       if (err)  {
           log.error(err, meta);
       }
    });
};

/**
 *
 * @param user
 * @param post
 * @param providerName
 * @param blogId
 * @param callback
 * @private
 */
BlogBot._requestPostContent = function (user, post, providerName, blogId, callback) {
    var meta={};

    meta.cName = this.name;
    meta.fName = "_requestPostContent";
    meta.userId = user._id.toString();

    var url = "http://www.justwapps.com/"+providerName + "/bot_posts";
    url += "/new";
    url += "/"+encodeURIComponent(blogId);
    url += "?";
    url += "userid=" + user._id;
    //url += "&";
    //url += "postType=" + postType;

    var opt = { form: post };

    log.debug("Post url="+url, meta);
    request.postEx(url, opt, function (err, response, body) {
        if (err)  {
            log.error(err, meta);
            BlogBot._addHistory(user, post, err.statusCode);
            return callback(err);
        }

        var rcvPosts;
        try {
            rcvPosts = JSON.parse(body);
        }
        catch(e) {
            e.exMessage = "Fail to parse body";
            e.statusCode = 500;
            log.error(e, meta);
            log.error(body, meta);
            BlogBot._addHistory(user, post, err.statusCode);
            return callback(e);
        }

        callback(null, user, rcvPosts);

        if (rcvPosts.posts) {
            BlogBot._addHistory(user, post, response.statusCode, rcvPosts.posts[0]);
        }
        else {
            BlogBot._addHistory(user, post, response.statusCode);
        }
    });
};

/**
 *
 * @param {object} postDb
 * @param {number} reqStartNum
 * @param {number} reqTotalCnt
 * @returns {{}}
 * @private
 */
BlogBot._getParsedPostDb = function (postDb, reqStartNum, reqTotalCnt) {

    var parsePostDb;
    var rangeStartNum = reqStartNum;
    var rangeTotalNum = reqTotalCnt;
    var rangeLastNum;
    var j;

    parsePostDb = {};
    parsePostDb.posts = [];
    rangeLastNum = rangeStartNum + rangeTotalNum;

    for (j=reqStartNum; j<rangeLastNum; j+=1 ) {
        if(!postDb.posts[j]) {
            break;
        }

        parsePostDb.posts.push(postDb.posts[j]);
    }

    return parsePostDb;
};

/**
 *
 * @param user
 * @param startNum
 * @param totalNum
 * @returns {*|Array}
 */
BlogBot.getPosts = function (user, startNum, totalNum) {
    var postDb;
    var parsedPostDb;
    var meta={};

    meta.cName = this.name;
    meta.fName = "getPosts";
    meta.userId = user._id.toString();

    postDb = BlogBot._findDbByUser(user, "post");
    log.debug("Total posts length="+postDb.posts.length, meta);
    parsedPostDb = BlogBot._getParsedPostDb(postDb, Number(startNum), Number(totalNum));

    log.debug("startNum=" + startNum + ", totalNum=" + totalNum, meta);

    if (parsedPostDb) {
        log.debug("Posts length="+parsedPostDb.posts.length, meta);
        return parsedPostDb.posts;
    }

    log.error("Fail to find PostDb", meta);
};

/**
 * this function is not used?
 * @param user
 * @param postID
 * @param {functions} callback
 */
BlogBot.getReplies = function (user, postID, callback) {
    var postDb;
    var post;
    var i;
    var meta={};

    meta.cName = this.name;
    meta.fName = "getReplies";
    meta.userId = user._id.toString();

    postDb = BlogBot._findDbByUser(user, "post");
    post = postDb.findPostById(postID);

    for (i=0; i<post.infos.length; i+=1) {
        BlogBot._requestGetPosts(user, post.infos[i].provider_name, post.infos[i].blog_id,
            {"post_id":post.infos[i].post_id},
            function (err, user, rcvPosts) {
                if (err) {
                    log.error(err, meta);
                    return callback(err);
                }

                if (!rcvPosts || !rcvPosts.posts)  {
                    var error = new Error("Fail to get rcvPosts or posts of rcvPosts");
                    error.statusCode = 500;
                    log.error(error, meta);
                    callback(error);
                    return;
                }

                var rcvPost = rcvPosts.posts[0];
                var sendData = {};
                sendData.providerName = rcvPosts.provider_name;
                sendData.blogID = rcvPosts.blog_id;
                sendData.postID = rcvPost.id;
                sendData.replies = rcvPost.replies;

                //log.debug(send_data, meta);
                callback(null, sendData);
            });
    }
};

/**
 *
 * @param user
 * @param providerName
 * @param blogID
 * @param postID
 * @param {function} callback
 */
BlogBot.getRepliesByInfo = function (user, providerName, blogID, postID, callback) {
    var meta={};

    meta.cName = this.name;
    meta.fName = "getRepliesByInfo";
    meta.userId = user._id.toString();

    BlogBot._requestGetPosts(user, providerName, blogID, {"post_id":postID},
        function (err, user, rcvPosts) {
            if (err) {
                log.error(err, meta);
                return callback(err);
            }

            if (!rcvPosts || !rcvPosts.posts)  {
                var error = new Error("Fail to get rcvPosts or posts of recvPosts");
                error.statusCode = 500;
                log.error(error, meta);
                log.error(rcvPosts, meta);
                return callback(error);
            }

            var rcvPost = rcvPosts.posts[0];
            var sendData = {};
            sendData.providerName = rcvPosts.provider_name;
            sendData.blogID = rcvPosts.blog_id;
            sendData.postID = rcvPost.id;
            sendData.replies = rcvPost.replies;

            //log.debug(sendData, meta);
            return callback(null, sendData);
        });
};

module.exports = BlogBot;

