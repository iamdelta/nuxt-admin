const Router = require("koa-router");
const {
	Post,
	mySequelize,
	Relationship,
	Category
} = require("../lib/orm_order");

const sequelize = require("sequelize");
const Op = sequelize.Op;

const router = new Router({
	prefix: "/api"
});

let findOrCreate = async (op, t) => {
	return await Post.findOrCreate({
		where: {
			post_title: op.title
		},
		defaults: {
			post_author: op.author,
			post_content: op.content,
			post_describe: op.describe,
			feature_image: op.featureImage,
			post_status: op.status,
			comment_status: op.commentStatus,
			createdAt: new Date(),
			updatedAt: new Date()
		},
		transaction: t
	});
};

router.post("/addAndUpdatePost", async ctx => {
	let {
			id,
			author,
			title,
			content,
			describe,
			category,
			categoryUpdate,
			status,
			featureImage,
			commentStatus
		} = ctx.request.body,
		relationshipArr = [],
		postId = null;
	if (id && isNaN(parseInt(id))) {
		//id非数字类型时
		return (ctx.body = {
			result: false,
			message: "请输入正确的字段值！"
		});
	}

	if (!id) {
		//不存在id则插入数据
		await mySequelize.transaction(async t => {
			//递归查询标题是否存在
			async function titleFcn(titl) {
				let resCre = await findOrCreate(
					{
						author: author,
						title: titl ? titl : "not titile",
						content: content,
						describe: describe,
						status: status,
						featureImage: featureImage,
						commentStatus: commentStatus
					},
					t
				);
				if (!resCre[1]) {
					//标题已存在递归查询标题
					return await titleFcn(titl + "(新)");
				} else {
					return resCre;
				}
			}
			let postRes = await titleFcn(title);
			postId = postRes[0].dataValues.id;
			if (category && Array.isArray(category)) {
				for (let i in category) {
					relationshipArr[i] = {};
					relationshipArr[i].object_id = postId;
					relationshipArr[i].term_taxonomy_id = category[i];
				}
				await Relationship.bulkCreate(relationshipArr, {
					transaction: t
				});
			}
			return (ctx.body = {
				result: true,
				id: postId,
				postTitle: postRes[0].dataValues.post_title
			});
		});
	} else {
		//存在id则修改post内容
		await mySequelize.transaction(async t => {
			async function titleFcn(titl) {
				//递归函数，递归查询是否文章标题重复，更新不重复的标题
				let findRes = await Post.findOne({
					where: {
						post_title: titl,
						id: {
							[Op.ne]: id
						}
					}
				});
				if (findRes) {
					title = titl + "(新)";
					return await titleFcn(title);
				} else {
					return true;
				}
			}
			title ? await titleFcn(title) : null;

			let res = await Post.update(
				{
					post_author: author,
					post_title: title,
					post_content: content,
					post_describe: describe,
					post_status: status,
					feature_image: featureImage,
					comment_status: commentStatus,
					updatedAt: new Date()
				},
				{
					where: {
						id: id
					},
					transaction: t
				}
			);
			if (res[0] === 0) {
				return (ctx.body = {
					result: false,
					message: "不存在该文章！"
				});
			}
			if (categoryUpdate) {
				//分类有更新
				await Relationship.destroy({
					where: {
						object_id: id
					},
					transaction: t
				});
				if (category && Array.isArray(category)) {
					for (let i in category) {
						relationshipArr[i] = {};
						relationshipArr[i].object_id = id;
						relationshipArr[i].term_taxonomy_id = category[i];
					}
					await Relationship.bulkCreate(relationshipArr, {
						transaction: t
					});
				}
			}
			return (ctx.body = {
				result: true,
				postTitle: title
			});
		});
	}
});

router.get("/findPost", async ctx => {
	let postId = ctx.request.query.id,
		postTitle = ctx.request.query.title,
		findRes = null,
		category = null;
	if (postId) {
		findRes = await Post.findOne({
			attributes: [
				["id", "postId"],
				["post_author", "author"],
				["post_title", "postTitle"],
				["post_content", "editContent"],
				["post_describe", "postDescribe"],
				["feature_image", "coverImg"],
				["post_status", "postStatus"],
				["comment_status", "commentStatus"]
			],
			where: {
				id: postId
			}
		});
	}
	category = await Category.findAll({
		attributes: [
			["name", "cName"],
			["id", "cValue"]
		],
		include: [
			{
				model: Relationship,
				// where: {
				// 	object_id: postId
				// },
				attributes: [["object_id", "postId"]]
			}
		]
	});

	if (findRes === null) {
		//无结果只返回分类查询数据
		return (ctx.body = {
			result: true,
			category: category
		});
	}
	ctx.body = {
		result: true,
		post: findRes,
		category: category
	};
});

router.post("/findAllPost", async ctx => {
	let { title, time, page, category } = ctx.request.body,
		whereObj = {};
	if (!page || isNaN(parseInt(page)) || (!!time && !Array.isArray(time))) {
		return (ctx.body = {
			result: false,
			message: "请输入正确的字段或值！"
		});
	}
	if (title) {
		whereObj.post_title = {
			[Op.like]: "%" + title + "%"
		};
	}
	if (time) {
		whereObj.createdAt = {
			[Op.between]: time
		};
	}
	if (category && !isNaN(parseInt(category))) {
		let res = await Post.findAndCountAll({
			order: [
				//倒序排列updatedAt数据
				["updatedAt", "DESC"]
			],
			where: whereObj,
			attributes: [
				["post_title", "title"],
				["post_describe", "describe"],
				["createdAt", "createdAt"],
				["updatedAt", "last_modified_date"],
				["post_status", "publish_status"],
				["like_count", "like_count"],
				["pv", "pv"]
			],
			offset: 10 * (page - 1),
			limit: 10,
			include: [
				{
					model: Relationship,
					where: {
						term_taxonomy_id: category
					},
					attributes: [["object_id", "id"]]
				}
			]
		});
		return (ctx.body = {
			result: true,
			postList: res
		});
	}
	let res = await Post.findAndCountAll({
		order: [
			//倒序排列updatedAt数据
			["updatedAt", "DESC"]
		],
		where: whereObj,
		attributes: [
			["id", "id"],
			["post_title", "title"],
			["post_describe", "describe"],
			["createdAt", "createdAt"],
			["updatedAt", "last_modified_date"],
			["post_status", "publish_status"],
			["like_count", "like_count"],
			["pv", "pv"]
		],
		offset: 10 * (page - 1),
		limit: 10
	});
	return (ctx.body = {
		result: true,
		postList: res
	});
});

router.post("/deletePost", async ctx => {
	let { postId } = ctx.request.body;
	if (!postId || (!!postId && !Array.isArray(postId))) {
		return (ctx.body = {
			result: false,
			message: "请输入正确的字段或值！"
		});
	}
	await mySequelize.transaction(async t => {
		let postRes = await mySequelize.queryInterface.bulkDelete(
			"posts",
			{
				id: {
					[Op.in]: postId
				}
			},
			{
				transaction: t
			}
		);
		await mySequelize.queryInterface.bulkDelete(
			"term_relationships",
			{
				object_id: {
					[Op.in]: postId
				}
			},
			{
				transaction: t
			}
		);
		if (postRes[0].affectedRows === 0) {
			return (ctx.body = {
				result: false,
				message: "不存在的文章！"
			});
		}
		return (ctx.body = {
			result: true
		});
	});
});

router.get("/getCategory", async ctx => {
	let res = await Relationship.findAll({
		attributes: [
			["term_taxonomy_id", "cId"],
			[sequelize.fn("COUNT", sequelize.col("term_taxonomy_id")), "count"]
		],
		group: "term_taxonomy_id",
		include: [
			{
				model: Category,
				attributes: [["name", "cName"], "slug"]
			}
		]
	});
	ctx.body = {
		result: true,
		data: res
	};
});

router.post("/addCategory", async ctx => {
	let { cName } = ctx.request.body,
		slug = null;
	if (!cName) {
		return (ctx.body = {
			result: false,
			message: "请输入正确都字段或值！"
		});
	}
	slug = cName.replace(/[ |_]/g, "-");
	let res = await Category.findOrCreate({
		where: {
			slug: slug
		},
		defaults: {
			name: cName
		}
	});
	if (res[1]) {
		return (ctx.body = {
			result: true,
			data: res
		});
	} else {
		return (ctx.body = {
			result: false,
			message: "该分类名已存在！",
			data: res
		});
	}
});

router.post("/deleteCategory", async ctx => {
	let { cId } = ctx.request.body;
	if (!cId || isNaN(parseInt(cId))) {
		//如果不存在或者不为数字类型
		return (ctx.body = {
			result: false,
			message: "请输入正确的字段或值！"
		});
	}
	let res = await Category.destroy({
		where: {
			id: cId
		}
	});
	if (res === 0) {
		return (ctx.body = {
			result: false,
			message: "不存在该分类！"
		});
	}
	return (ctx.body = {
		result: true
	});
});

module.exports = router;
